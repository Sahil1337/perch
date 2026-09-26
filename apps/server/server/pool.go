package server

import (
	"context"
	"sync"
	"time"

	"perch/db"
	"perch/httpx"
	"perch/protocol"
	"perch/storage"
)

const schemaTTL = 60 * time.Second

// Pool holds live drivers keyed by connection id: the one piece of shared mutable state the API
// keeps about databases. A driver is created and connected lazily on first use and stays until
// the connection is edited, disconnected, or the server shuts down.
type Pool struct {
	mu      sync.Mutex
	entries map[string]*poolEntry
	schemas map[string]schemaEntry
}

type poolEntry struct {
	config    protocol.ConnectionConfig
	driver    db.Driver
	status    protocol.ConnectionStatus
	err       string
	databases []string
}

type schemaEntry struct {
	schema   protocol.DatabaseSchema
	cachedAt time.Time
}

func NewPool() *Pool {
	return &Pool{entries: map[string]*poolEntry{}, schemas: map[string]schemaEntry{}}
}

func (p *Pool) Config(idOrName string) (protocol.ConnectionConfig, error) {
	config, ok, err := storage.GetConnection(idOrName)
	if err != nil {
		return config, err
	}
	if !ok {
		return config, httpx.NotFound("no such connection: " + idOrName)
	}
	return config, nil
}

func (p *Pool) entry(config protocol.ConnectionConfig) (*poolEntry, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if existing, ok := p.entries[config.ID]; ok {
		existing.config = config
		return existing, nil
	}
	// db/ returns plain errors by design — it may not import the HTTP layer. This is the seam
	// where they become an answerable failure rather than an unexplained 500.
	driver, err := db.NewDriver(config)
	if err != nil {
		return nil, httpx.BadRequest(err.Error(), "driver_unavailable")
	}
	entry := &poolEntry{config: config, driver: driver, status: protocol.StatusDisconnected}
	p.entries[config.ID] = entry
	return entry, nil
}

// DriverFor returns a connected driver, creating and connecting it lazily on first use.
func (p *Pool) DriverFor(ctx context.Context, idOrName string) (db.Driver, error) {
	config, err := p.Config(idOrName)
	if err != nil {
		return nil, err
	}
	entry, err := p.entry(config)
	if err != nil {
		return nil, err
	}
	if entry.driver.IsConnected() {
		p.mu.Lock()
		entry.status = protocol.StatusConnected
		p.mu.Unlock()
		return entry.driver, nil
	}
	if err := entry.driver.Connect(ctx); err != nil {
		failure := db.Classify(config, err)
		p.mu.Lock()
		entry.status = protocol.StatusError
		entry.err = failure.Message
		p.mu.Unlock()
		return nil, httpx.BadRequest(failure.Message, string(failure.Code))
	}
	p.mu.Lock()
	entry.status = protocol.StatusConnected
	entry.err = ""
	p.mu.Unlock()
	return entry.driver, nil
}

func (p *Pool) Summary(config protocol.ConnectionConfig) protocol.ConnectionSummary {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry, ok := p.entries[config.ID]

	status := protocol.StatusDisconnected
	errMsg := ""
	var databases []string
	if ok {
		if entry.driver.IsConnected() {
			status = protocol.StatusConnected
			databases = entry.databases
		} else if entry.status == protocol.StatusError {
			status = protocol.StatusError
		}
		errMsg = entry.err
	}
	return config.Summary(status, errMsg, databases)
}

func (p *Pool) Summaries() ([]protocol.ConnectionSummary, error) {
	list, err := storage.ListConnections()
	if err != nil {
		return nil, err
	}
	out := make([]protocol.ConnectionSummary, 0, len(list))
	for _, config := range list {
		out = append(out, p.Summary(config))
	}
	return out, nil
}

func (p *Pool) Connect(ctx context.Context, idOrName string) (protocol.ConnectionSummary, error) {
	config, err := p.Config(idOrName)
	if err != nil {
		return protocol.ConnectionSummary{}, err
	}
	driver, err := p.DriverFor(ctx, config.ID)
	if err != nil {
		return protocol.ConnectionSummary{}, err
	}
	// Not every server lets us enumerate databases; the connection is still usable.
	if databases, err := driver.ListDatabases(ctx); err == nil {
		p.mu.Lock()
		if entry, ok := p.entries[config.ID]; ok {
			entry.databases = databases
		}
		p.mu.Unlock()
	}
	return p.Summary(config), nil
}

func (p *Pool) Disconnect(idOrName string) (protocol.ConnectionSummary, error) {
	config, err := p.Config(idOrName)
	if err != nil {
		return protocol.ConnectionSummary{}, err
	}
	p.mu.Lock()
	entry, ok := p.entries[config.ID]
	p.mu.Unlock()
	if ok {
		_ = entry.driver.Disconnect()
		p.mu.Lock()
		entry.status = protocol.StatusDisconnected
		entry.databases = nil
		entry.err = ""
		p.mu.Unlock()
	}
	p.dropSchemas(config.ID)
	return p.Summary(config), nil
}

// Forget drops any live driver for a connection — call after its config changes or it is deleted.
func (p *Pool) Forget(connectionID string) {
	p.mu.Lock()
	entry, ok := p.entries[connectionID]
	delete(p.entries, connectionID)
	p.mu.Unlock()
	p.dropSchemas(connectionID)
	if ok {
		_ = entry.driver.Disconnect()
	}
}

func (p *Pool) Test(ctx context.Context, idOrName string) (string, int64, error) {
	config, err := p.Config(idOrName)
	if err != nil {
		return "", 0, err
	}
	driver, err := p.DriverFor(ctx, config.ID)
	if err != nil {
		return "", 0, err
	}
	version, latency, err := driver.Test(ctx)
	if err != nil {
		failure := db.Classify(config, err)
		return "", 0, httpx.BadRequest(failure.Message, string(failure.Code))
	}
	return version, latency, nil
}

func (p *Pool) Databases(ctx context.Context, idOrName string) ([]string, error) {
	config, err := p.Config(idOrName)
	if err != nil {
		return nil, err
	}
	driver, err := p.DriverFor(ctx, config.ID)
	if err != nil {
		return nil, err
	}
	databases, err := driver.ListDatabases(ctx)
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	if entry, ok := p.entries[config.ID]; ok {
		entry.databases = databases
	}
	p.mu.Unlock()
	return databases, nil
}

func (p *Pool) Schema(ctx context.Context, idOrName, database string, refresh bool) (protocol.DatabaseSchema, error) {
	config, err := p.Config(idOrName)
	if err != nil {
		return protocol.DatabaseSchema{}, err
	}
	cacheKey := config.ID + "\x00" + database
	if !refresh {
		p.mu.Lock()
		hit, ok := p.schemas[cacheKey]
		p.mu.Unlock()
		if ok && time.Since(hit.cachedAt) < schemaTTL {
			return hit.schema, nil
		}
	}
	driver, err := p.DriverFor(ctx, config.ID)
	if err != nil {
		return protocol.DatabaseSchema{}, err
	}
	schema, err := driver.GetSchema(ctx, database)
	if err != nil {
		return protocol.DatabaseSchema{}, err
	}
	p.mu.Lock()
	p.schemas[cacheKey] = schemaEntry{schema: schema, cachedAt: time.Now()}
	p.mu.Unlock()
	return schema, nil
}

func (p *Pool) dropSchemas(connectionID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	prefix := connectionID + "\x00"
	for k := range p.schemas {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			delete(p.schemas, k)
		}
	}
}

// Shutdown disconnects every live driver.
func (p *Pool) Shutdown() {
	p.mu.Lock()
	entries := make([]*poolEntry, 0, len(p.entries))
	for _, entry := range p.entries {
		entries = append(entries, entry)
	}
	p.entries = map[string]*poolEntry{}
	p.schemas = map[string]schemaEntry{}
	p.mu.Unlock()

	for _, entry := range entries {
		_ = entry.driver.Disconnect()
	}
}
