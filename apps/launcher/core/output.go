package core

import (
	"strings"
	"sync"
)

// Output keeps the tail of one server run in memory for show-log, in fixed rings so a chatty
// server can never grow the launcher. Nothing is written to disk.
type Output struct {
	mu     sync.Mutex
	all    ring
	stderr ring
}

func NewOutput() *Output {
	return &Output{all: newRing(64 << 10), stderr: newRing(4 << 10)}
}

type stream struct {
	o     *Output
	isErr bool
}

func (s stream) Write(b []byte) (int, error) {
	s.o.mu.Lock()
	defer s.o.mu.Unlock()
	s.o.all.write(b)
	if s.isErr {
		s.o.stderr.write(b)
	}
	return len(b), nil
}

func (o *Output) stream(isErr bool) stream { return stream{o, isErr} }

func (o *Output) Text() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return string(o.all.bytes())
}

func (o *Output) LastError() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return lastLine(o.stderr.bytes())
}

type ring struct {
	buf  []byte
	next int
	full bool
}

func newRing(size int) ring { return ring{buf: make([]byte, size)} }

func (r *ring) write(b []byte) {
	if len(b) >= len(r.buf) {
		copy(r.buf, b[len(b)-len(r.buf):])
		r.next, r.full = 0, true
		return
	}
	n := copy(r.buf[r.next:], b)
	if n < len(b) {
		copy(r.buf, b[n:])
		r.full = true
	}
	r.next = (r.next + len(b)) % len(r.buf)
	if r.next == 0 {
		r.full = true
	}
}

func (r *ring) bytes() []byte {
	if !r.full {
		return append([]byte(nil), r.buf[:r.next]...)
	}
	return append(append([]byte(nil), r.buf[r.next:]...), r.buf[:r.next]...)
}

func lastLine(b []byte) string {
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}
