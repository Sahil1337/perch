package storage

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"perch/fsx"
)

// Store is one small JSON document under perch home. It binds the filename, what a missing file
// reads as, and the mode it must be written with — connections.json holds passwords, so 0600 is
// a property of the file rather than something each writer remembers.
type Store[T any] struct {
	name     string
	mode     fs.FileMode
	fallback func() T
	mu       sync.Mutex
}

func NewStore[T any](name string, mode fs.FileMode, fallback func() T) *Store[T] {
	return &Store[T]{name: name, mode: mode, fallback: fallback}
}

func (s *Store[T]) Read() (T, error) {
	dir, err := EnsureDir()
	if err != nil {
		var zero T
		return zero, err
	}
	data, err := os.ReadFile(filepath.Join(dir, s.name))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return s.fallback(), nil
		}
		var zero T
		return zero, err
	}
	// Unmarshal over the fallback rather than a zero value, so a partial document merges the
	// way the TypeScript server's `{...defaults, ...stored}` did.
	value := s.fallback()
	if err := json.Unmarshal(data, &value); err != nil {
		var zero T
		return zero, err
	}
	return value, nil
}

func (s *Store[T]) Write(value T) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir, err := EnsureDir()
	if err != nil {
		return err
	}
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return fsx.WriteAtomic(filepath.Join(dir, s.name), append(body, '\n'), s.mode)
}

// Remove deletes the document. Unlike a read it does not create perch home first.
func (s *Store[T]) Remove() error {
	err := os.Remove(ConfigFile(s.name))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}
