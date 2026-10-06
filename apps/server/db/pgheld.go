package db

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"perch/protocol"
)

// A string so a throwaway build can shorten it: -ldflags "-X perch/db.idleTransactionTimeout=20s".
var idleTransactionTimeout = "15m"

func idleLimit() time.Duration {
	if limit, err := time.ParseDuration(idleTransactionTimeout); err == nil && limit > 0 {
		return limit
	}
	return 15 * time.Minute
}

var (
	errKeyBusy      = errors.New("This tab's transaction is busy with another run.")
	errKeyRunning   = errors.New("This tab is already running a query. Wait for it to finish, or cancel it.")
	errHeldConnGone = errors.New("The connection was lost, so the open transaction was rolled back.")
)

// keyedSession is a session key's claim on a database. It is busy while one of the key's runs
// executes, which is what turns a second one away, and between runs it holds the connection a
// run left inside a transaction.
type keyedSession struct {
	database string
	key      string
	busy     bool
	session  *pgSession
	// What session holds; kept while a run has it, so a run turned away can still say.
	state    protocol.TransactionState
	lastUsed time.Time
	idle     *time.Timer
}

func heldID(database, key string) string { return database + "\x00" + key }

func (d *postgresDriver) OnClosed(fn func(database, sessionKey string, reason protocol.TransactionReason)) {
	d.onClosed = fn
}

func (d *postgresDriver) closed(claim *keyedSession, reason protocol.TransactionReason) {
	if d.onClosed != nil {
		d.onClosed(claim.database, claim.key, reason)
	}
}

// claim marks the key busy for a run and hands back the session it holds, if any. A key whose
// transaction was rolled back while idle says so, once, to the run that finds it gone.
func (d *postgresDriver) claim(ctx context.Context, database, key string, notice func(string)) (*keyedSession, *pgSession, error) {
	id := heldID(database, key)
	d.keysMu.Lock()
	claim, ok := d.keyed[id]
	if ok && claim.busy {
		d.keysMu.Unlock()
		if claim.session != nil {
			return nil, nil, errKeyBusy
		}
		return nil, nil, errKeyRunning
	}
	tombstone, buried := d.tombstones[id]
	delete(d.tombstones, id)
	if !ok {
		claim = &keyedSession{database: database, key: key}
		d.keyed[id] = claim
	}
	claim.busy = true
	if claim.idle != nil {
		claim.idle.Stop()
	}
	held := claim.session
	d.keysMu.Unlock()

	if buried {
		notice(tombstone)
	}
	if held == nil {
		return claim, nil, nil
	}
	// A held connection can die quietly: idle_in_transaction_session_timeout, a restart, the
	// network. Better to find out here than halfway into the tab's next statement. An empty query
	// is answered even inside a failed transaction.
	pingCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), sessionCloseTimeout)
	err := held.conn.Ping(pingCtx)
	cancel()
	if err != nil {
		d.unclaim(claim)
		discard(held.conn)
		d.closed(claim, protocol.ReasonLost)
		return nil, nil, errHeldConnGone
	}
	return claim, held, nil
}

func (d *postgresDriver) unclaim(claim *keyedSession) {
	if claim == nil {
		return
	}
	d.keysMu.Lock()
	if d.keyed[heldID(claim.database, claim.key)] == claim {
		delete(d.keyed, heldID(claim.database, claim.key))
	}
	d.keysMu.Unlock()
}

// hold keeps a run's session for its key's next run. False when the key was released or the
// driver disconnected while the run executed: the transaction has nowhere to be kept.
func (d *postgresDriver) hold(s *pgSession, status byte) (protocol.TransactionState, bool) {
	claim := s.claim
	if claim == nil {
		return "", false
	}
	state := protocol.TransactionOpen
	if status == 'E' {
		state = protocol.TransactionFailed
	}
	d.keysMu.Lock()
	defer d.keysMu.Unlock()
	if d.keyed[heldID(claim.database, claim.key)] != claim {
		return "", false
	}
	claim.busy = false
	claim.session = s
	claim.state = state
	claim.lastUsed = time.Now()
	claim.idle = time.AfterFunc(idleLimit(), func() { d.expire(claim) })
	return state, true
}

func (d *postgresDriver) heldState(opts RunOptions) *protocol.TransactionState {
	d.keysMu.Lock()
	defer d.keysMu.Unlock()
	claim, ok := d.keyed[heldID(d.databaseName(opts.Database), opts.SessionKey)]
	if !ok || claim.session == nil {
		return nil
	}
	state := claim.state
	return &state
}

func (d *postgresDriver) expire(claim *keyedSession) {
	id := heldID(claim.database, claim.key)
	d.keysMu.Lock()
	// The timer can fire as a run takes the key; that run's use restarts the clock.
	if d.keyed[id] != claim || claim.busy || time.Since(claim.lastUsed) < idleLimit() {
		d.keysMu.Unlock()
		return
	}
	delete(d.keyed, id)
	d.tombstones[id] = fmt.Sprintf("The open transaction was rolled back after %s idle.", spell(idleLimit()))
	d.keysMu.Unlock()
	d.finish([]*keyedSession{claim}, protocol.ReasonIdle)
}

// Release is for a closed tab. A run of the key's still executing loses its claim, so it rolls
// back at the end rather than hold a transaction nobody can reach.
func (d *postgresDriver) Release(sessionKey string) int {
	d.keysMu.Lock()
	var held []*keyedSession
	for id, claim := range d.keyed {
		if claim.key != sessionKey {
			continue
		}
		delete(d.keyed, id)
		if claim.idle != nil {
			claim.idle.Stop()
		}
		if !claim.busy && claim.session != nil {
			held = append(held, claim)
		}
	}
	for id := range d.tombstones {
		if _, key, _ := strings.Cut(id, "\x00"); key == sessionKey {
			delete(d.tombstones, id)
		}
	}
	d.keysMu.Unlock()
	d.finish(held, protocol.ReasonReleased)
	return len(held)
}

// dropHeld rolls back every held session before a disconnect: pgxpool.Close waits for every
// connection to come back, and a held one never would.
func (d *postgresDriver) dropHeld() {
	d.keysMu.Lock()
	claims := d.keyed
	d.keyed = map[string]*keyedSession{}
	d.tombstones = map[string]string{}
	d.keysMu.Unlock()

	var held []*keyedSession
	for _, claim := range claims {
		if claim.idle != nil {
			claim.idle.Stop()
		}
		if !claim.busy && claim.session != nil {
			held = append(held, claim)
		}
	}
	d.finish(held, protocol.ReasonDisconnected)
}

func (d *postgresDriver) finish(held []*keyedSession, reason protocol.TransactionReason) {
	for _, claim := range held {
		ctx, cancel := context.WithTimeout(context.Background(), sessionCloseTimeout)
		_ = reset(ctx, claim.session.conn, true)
		cancel()
		d.closed(claim, reason)
	}
}

// holding counts the connections to database that sit between runs with a transaction open.
func (d *postgresDriver) holding(database string) int {
	d.keysMu.Lock()
	defer d.keysMu.Unlock()
	n := 0
	for _, claim := range d.keyed {
		if claim.database == database && !claim.busy && claim.session != nil {
			n++
		}
	}
	return n
}

func busyError(max int32, database string, held int) error {
	switch held {
	case 0:
		return fmt.Errorf("All %d connections to %s are busy. Try again when a run finishes.", max, database)
	case 1:
		return fmt.Errorf("All %d connections to %s are busy; 1 is holding an open transaction. Commit or roll back to free it.", max, database)
	}
	return fmt.Errorf("All %d connections to %s are busy; %d are holding open transactions. Commit or roll back to free them.", max, database, held)
}

// spell says a duration the way the idle notice wants it: "15 minutes", "20 seconds".
func spell(limit time.Duration) string {
	count, unit := int(limit/time.Second), "second"
	if limit%time.Minute == 0 {
		count, unit = int(limit/time.Minute), "minute"
	}
	if count != 1 {
		unit += "s"
	}
	return fmt.Sprintf("%d %s", count, unit)
}
