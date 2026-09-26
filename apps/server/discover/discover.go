// Package discover looks for Postgres and MySQL servers already installed or running on this
// machine. perch never bundles a database; it offers to connect to what is already there.
//
// Every probe is best-effort and short-timeout: discovery never fails, it just finds less.
package discover

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"perch/protocol"
)

// A UI that polls discovery should not shell out every time.
const memoFor = 30 * time.Second

const (
	probeTimeout = 300 * time.Millisecond
	execTimeout  = 2 * time.Second
)

type Service struct {
	mu      sync.Mutex
	last    *protocol.DiscoveryResult
	lastAt  time.Time
	running bool
}

func New() *Service { return &Service{} }

func (s *Service) Result(ctx context.Context, rescan bool) protocol.DiscoveryResult {
	s.mu.Lock()
	if !rescan && s.last != nil && time.Since(s.lastAt) < memoFor {
		result := *s.last
		s.mu.Unlock()
		return result
	}
	s.mu.Unlock()

	result := scan(ctx)

	s.mu.Lock()
	s.last = &result
	s.lastAt = time.Now()
	s.mu.Unlock()
	return result
}

type candidate struct {
	dialect protocol.Dialect
	host    string
	port    int
	source  protocol.DiscoverySource
	version string
	label   string
	// Filled in by the container probe, which can read the login the image was started with.
	// Empty means "use the dialect's default".
	user     string
	database string
}

func scan(ctx context.Context) protocol.DiscoveryResult {
	started := time.Now()

	var mu sync.Mutex
	found := []candidate{}
	collect := func(items []candidate) {
		mu.Lock()
		found = append(found, items...)
		mu.Unlock()
	}

	var wg sync.WaitGroup
	for _, probe := range []func(context.Context) []candidate{
		probePorts, probeBinaries, probeDocker, probeServices,
	} {
		wg.Add(1)
		go func(fn func(context.Context) []candidate) {
			defer wg.Done()
			collect(fn(ctx))
		}(probe)
	}
	wg.Wait()

	return protocol.DiscoveryResult{
		Servers:    merge(found),
		OSUser:     osUser(),
		ScannedAt:  protocol.Now(),
		DurationMs: time.Since(started).Milliseconds(),
	}
}

// merge folds the probes together by dialect+host+port: several may agree on the same server.
func merge(candidates []candidate) []protocol.DiscoveredServer {
	type key struct {
		dialect protocol.Dialect
		host    string
		port    int
	}
	order := []key{}
	byKey := map[key]*protocol.DiscoveredServer{}

	for _, c := range candidates {
		k := key{c.dialect, c.host, c.port}
		server, ok := byKey[k]
		if !ok {
			server = &protocol.DiscoveredServer{
				Dialect:      c.dialect,
				Host:         c.host,
				Port:         c.port,
				Sources:      []protocol.DiscoverySource{},
				SuggestedURL: suggestedURL(c.dialect, c.host, c.port),
			}
			byKey[k] = server
			order = append(order, k)
		}
		if !hasSource(server.Sources, c.source) {
			server.Sources = append(server.Sources, c.source)
		}
		if server.Version == "" {
			server.Version = c.version
		}
		if server.Label == "" {
			server.Label = c.label
		}
		// A probe that knows the login outranks the guess merge started with: the container
		// probe reads it off the image's own environment, while the others only know an address.
		if c.user != "" || c.database != "" {
			server.SuggestedURL = credentialedURL(c)
		}
	}

	out := make([]protocol.DiscoveredServer, 0, len(order))
	for _, k := range order {
		server := byKey[k]
		server.Reachable = reachable(server.Host, server.Port)
		out = append(out, *server)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Reachable != out[j].Reachable {
			return out[i].Reachable
		}
		return out[i].Port < out[j].Port
	})
	return out
}

func hasSource(list []protocol.DiscoverySource, want protocol.DiscoverySource) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

func suggestedURL(dialect protocol.Dialect, host string, port int) string {
	if dialect == protocol.DialectMySQL {
		return fmt.Sprintf("mysql://root@%s:%d/", host, port)
	}
	return fmt.Sprintf("postgres://%s@%s:%d/postgres", osUser(), host, port)
}

// credentialedURL is suggestedURL for a candidate that knows better. A container has no account
// named after the person running it, so the OS user — the right guess for a server installed on
// this machine — is the one guess guaranteed to fail there.
func credentialedURL(c candidate) string {
	user, database := c.user, c.database
	scheme := "postgres"
	if c.dialect == protocol.DialectMySQL {
		scheme = "mysql"
		if user == "" {
			user = "root"
		}
	} else {
		if user == "" {
			user = "postgres"
		}
		if database == "" {
			database = user
		}
	}
	return fmt.Sprintf("%s://%s@%s:%d/%s", scheme, url.QueryEscape(user), c.host, c.port, url.PathEscape(database))
}

func reachable(host string, port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprint(port)), probeTimeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// The ports a default install listens on, plus the next one along: a second cluster on one
// machine conventionally takes it.
var defaultPorts = []struct {
	dialect protocol.Dialect
	port    int
}{
	{protocol.DialectPostgres, 5432},
	{protocol.DialectPostgres, 5433},
	{protocol.DialectMySQL, 3306},
	{protocol.DialectMySQL, 3307},
}

func probePorts(context.Context) []candidate {
	out := []candidate{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, target := range defaultPorts {
		wg.Add(1)
		go func(dialect protocol.Dialect, port int) {
			defer wg.Done()
			if !reachable("127.0.0.1", port) {
				return
			}
			mu.Lock()
			out = append(out, candidate{dialect: dialect, host: "127.0.0.1", port: port, source: protocol.SourcePort})
			mu.Unlock()
		}(target.dialect, target.port)
	}
	wg.Wait()
	return out
}

var binaries = []struct {
	dialect protocol.Dialect
	name    string
}{
	{protocol.DialectPostgres, "postgres"},
	{protocol.DialectPostgres, "psql"},
	{protocol.DialectMySQL, "mysqld"},
	{protocol.DialectMySQL, "mysql"},
}

func probeBinaries(ctx context.Context) []candidate {
	out := []candidate{}
	seen := map[protocol.Dialect]bool{}
	for _, binary := range binaries {
		if seen[binary.dialect] {
			continue
		}
		path, err := exec.LookPath(binary.name)
		if err != nil {
			continue
		}
		seen[binary.dialect] = true
		out = append(out, candidate{
			dialect: binary.dialect,
			host:    "127.0.0.1",
			port:    defaultPortFor(binary.dialect),
			source:  protocol.SourceBinary,
			version: binaryVersion(ctx, path),
			label:   path,
		})
	}
	return out
}

func defaultPortFor(dialect protocol.Dialect) int {
	if dialect == protocol.DialectMySQL {
		return 3306
	}
	return 5432
}

func binaryVersion(ctx context.Context, path string) string {
	out, err := run(ctx, path, "--version")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(firstLine(out))
}

// probeDocker reports running containers whose image looks like a database, with the host port
// its server port is published on and the login the image was started with.
//
// Three things it does not take for granted. The CLI may not be on PATH — Docker Desktop installs
// it where a GUI-launched process cannot see it, so the known locations are tried too. The
// runtime may not be Docker: podman and nerdctl speak the same two subcommands. And the login is
// never the OS user, which is why the image's own environment is read: a container has no account
// named after the person running it, so the default guess fails on every container there is.
func probeDocker(ctx context.Context) []candidate {
	cli, ok := containerCLI()
	if !ok {
		return nil
	}
	out, err := run(ctx, cli, "ps", "--format", "{{.ID}}\t{{.Image}}\t{{.Ports}}\t{{.Names}}")
	if err != nil {
		return nil
	}
	found := []candidate{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(strings.TrimSpace(line), "\t")
		if len(fields) < 4 {
			continue
		}
		id, image, ports, name := fields[0], strings.ToLower(fields[1]), fields[2], fields[3]
		dialect, ok := imageDialect(image)
		if !ok {
			continue
		}
		port, ok := publishedPort(ports, defaultPortFor(dialect))
		if !ok {
			// Published on a port the image does not normally use. It is still the only database
			// in that container, so the mapping is unambiguous.
			port, ok = anyPublishedPort(ports)
			if !ok {
				// Reachable only from inside the container network; nothing to offer.
				continue
			}
		}
		user, database := containerLogin(ctx, cli, id, dialect)
		found = append(found, candidate{
			dialect: dialect, host: "127.0.0.1", port: port,
			source: protocol.SourceDocker, label: name,
			user: user, database: database,
		})
	}
	return found
}

func imageDialect(image string) (protocol.Dialect, bool) {
	switch {
	case strings.Contains(image, "postgres"), strings.Contains(image, "pgvector"),
		strings.Contains(image, "timescale"):
		return protocol.DialectPostgres, true
	case strings.Contains(image, "mysql"), strings.Contains(image, "mariadb"),
		strings.Contains(image, "percona"):
		return protocol.DialectMySQL, true
	}
	return "", false
}

// Where a container CLI lives when it is not on PATH. Docker Desktop on macOS puts it in the
// user's home, and a process started from the Dock inherits none of a shell's PATH.
var containerCLIs = []string{"docker", "podman", "nerdctl"}

var containerCLIDirs = []string{
	"/usr/local/bin",
	"/opt/homebrew/bin",
	"/usr/bin",
	"/Applications/Docker.app/Contents/Resources/bin",
}

func containerCLI() (string, bool) {
	for _, name := range containerCLIs {
		if path, err := exec.LookPath(name); err == nil {
			return path, true
		}
	}
	home, _ := os.UserHomeDir()
	dirs := containerCLIDirs
	if home != "" {
		dirs = append([]string{filepath.Join(home, ".docker", "bin"), filepath.Join(home, ".rd", "bin")}, dirs...)
	}
	for _, dir := range dirs {
		for _, name := range containerCLIs {
			path := filepath.Join(dir, name)
			if info, err := os.Stat(path); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
				return path, true
			}
		}
	}
	return "", false
}

// containerLogin reads the user and database the image was started with. The password is in the
// same environment and is deliberately not read: perch asks for it rather than lifting a secret
// out of a process and writing it to disk.
func containerLogin(ctx context.Context, cli, id string, dialect protocol.Dialect) (user, database string) {
	out, err := run(ctx, cli, "inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", id)
	if err != nil {
		return "", ""
	}
	env := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if ok {
			env[key] = value
		}
	}
	if dialect == protocol.DialectMySQL {
		// MYSQL_USER is a second, non-root account the image creates; root is the one guaranteed
		// to exist, so it stays the suggestion.
		return "root", env["MYSQL_DATABASE"]
	}
	user = env["POSTGRES_USER"]
	if user == "" {
		user = "postgres"
	}
	database = env["POSTGRES_DB"]
	if database == "" {
		// The official image defaults the database to the user's name, not to `postgres`.
		database = user
	}
	return user, database
}

// publishedPort reads the host port out of docker's "0.0.0.0:5433->5432/tcp" mapping list.
func publishedPort(ports string, containerPort int) (int, bool) {
	return hostPortFor(ports, fmt.Sprintf("->%d/tcp", containerPort))
}

// anyPublishedPort is the fallback for a container that runs its database on a port the image
// does not normally use. MySQL's X protocol is excluded: it is published by the official image
// alongside the real one, and it does not speak the protocol the driver does.
func anyPublishedPort(ports string) (int, bool) {
	for _, mapping := range strings.Split(ports, ",") {
		if strings.HasSuffix(strings.TrimSpace(mapping), "->33060/tcp") {
			continue
		}
		if port, ok := hostPortFor(mapping, "/tcp"); ok {
			return port, true
		}
	}
	return 0, false
}

func hostPortFor(ports, suffix string) (int, bool) {
	for _, mapping := range strings.Split(ports, ",") {
		mapping = strings.TrimSpace(mapping)
		if !strings.HasSuffix(mapping, suffix) {
			continue
		}
		hostSide, _, ok := strings.Cut(mapping, "->")
		if !ok {
			// "5432/tcp" with no arrow: exposed, never published, so unreachable from here.
			continue
		}
		at := strings.LastIndex(hostSide, ":")
		if at == -1 {
			continue
		}
		var port int
		if _, err := fmt.Sscanf(hostSide[at+1:], "%d", &port); err == nil && port > 0 {
			return port, true
		}
	}
	return 0, false
}

func probeServices(ctx context.Context) []candidate {
	switch runtime.GOOS {
	case "darwin":
		return probeBrew(ctx)
	case "linux":
		return probeSystemd(ctx)
	case "windows":
		return probeWindowsServices(ctx)
	}
	return nil
}

func probeBrew(ctx context.Context) []candidate {
	out, err := run(ctx, "brew", "services", "list")
	if err != nil {
		return nil
	}
	return servicesFrom(out, protocol.SourceBrew, func(line string) bool {
		return strings.Contains(line, "started") || strings.Contains(line, "running")
	})
}

func probeSystemd(ctx context.Context) []candidate {
	out, err := run(ctx, "systemctl", "list-units", "--type=service", "--state=running", "--no-legend", "--no-pager")
	if err != nil {
		return nil
	}
	return servicesFrom(out, protocol.SourceSystemd, func(string) bool { return true })
}

func probeWindowsServices(ctx context.Context) []candidate {
	out, err := run(ctx, "sc", "query", "state=", "all")
	if err != nil {
		return nil
	}
	return servicesFrom(out, protocol.SourceWindows, func(string) bool { return true })
}

func servicesFrom(output string, source protocol.DiscoverySource, running func(string) bool) []candidate {
	found := []candidate{}
	seen := map[protocol.Dialect]bool{}
	for _, line := range strings.Split(output, "\n") {
		lower := strings.ToLower(line)
		if !running(lower) {
			continue
		}
		var dialect protocol.Dialect
		switch {
		case strings.Contains(lower, "postgres"):
			dialect = protocol.DialectPostgres
		case strings.Contains(lower, "mysql"), strings.Contains(lower, "mariadb"):
			dialect = protocol.DialectMySQL
		default:
			continue
		}
		if seen[dialect] {
			continue
		}
		seen[dialect] = true
		found = append(found, candidate{
			dialect: dialect, host: "127.0.0.1", port: defaultPortFor(dialect),
			source: source, label: strings.TrimSpace(firstField(line)),
		})
	}
	return found
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, execTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func firstLine(s string) string {
	if at := strings.IndexByte(s, '\n'); at != -1 {
		return s[:at]
	}
	return s
}

func firstField(s string) string {
	if fields := strings.Fields(s); len(fields) > 0 {
		return fields[0]
	}
	return ""
}

// The login a server on this machine is likeliest to accept when nothing else named one.
//
// On Unix the OS user is the convention and usually right: a package install creates a role named
// after whoever ran it, and peer auth matches on it. Windows has no such convention — the
// installer creates `postgres` and nothing else — and user.Current() there answers
// `MACHINE\Name`, a backslash and often a space that no role is ever called. Suggesting it
// produces a login certain to be refused, under a name nobody typed.
func osUser() string {
	if runtime.GOOS == "windows" {
		return "postgres"
	}
	if current, err := user.Current(); err == nil && current.Username != "" {
		return current.Username
	}
	return "postgres"
}
