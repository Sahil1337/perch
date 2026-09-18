package server

import (
	"sync"

	"perch/protocol"
)

// Bus fans server events out to every open SSE stream. Sends are non-blocking: a subscriber that
// has stopped reading loses events rather than stalling the watcher or a finishing run.
type Bus struct {
	mu   sync.RWMutex
	subs map[chan protocol.ServerEvent]struct{}
}

func NewBus() *Bus {
	return &Bus{subs: make(map[chan protocol.ServerEvent]struct{})}
}

func (b *Bus) Subscribe() chan protocol.ServerEvent {
	ch := make(chan protocol.ServerEvent, 64)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Bus) Unsubscribe(ch chan protocol.ServerEvent) {
	b.mu.Lock()
	if _, ok := b.subs[ch]; ok {
		delete(b.subs, ch)
		close(ch)
	}
	b.mu.Unlock()
}

func (b *Bus) Publish(event protocol.ServerEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs {
		select {
		case ch <- event:
		default:
		}
	}
}

func (b *Bus) CloseAll() {
	b.mu.Lock()
	for ch := range b.subs {
		delete(b.subs, ch)
		close(ch)
	}
	b.mu.Unlock()
}
