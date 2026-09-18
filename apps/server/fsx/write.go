// Package fsx holds the filesystem helpers the config store and the workspace editor share.
package fsx

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// WriteAtomic writes via a temp file in the same directory and renames, so a crash or a
// concurrent reader never sees a half-written file.
func WriteAtomic(file string, data []byte, mode fs.FileMode) error {
	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return err
	}
	tmp := filepath.Join(
		filepath.Dir(file),
		fmt.Sprintf(".%s.%d.%s.tmp", filepath.Base(file), os.Getpid(), hex.EncodeToString(suffix[:])),
	)

	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	if err := renameWithRetry(tmp, file); err != nil {
		os.Remove(tmp)
		return err
	}
	// WriteFile only applies mode when it creates the file; an existing temp name would keep
	// the old bits, and connections.json must stay 0600.
	return os.Chmod(file, mode)
}

// Rename over an existing file fails transiently on Windows while an editor, scanner or watcher
// briefly holds the target open. Elsewhere the first attempt always succeeds.
func renameWithRetry(from, to string) error {
	const attempts = 5
	for i := 0; ; i++ {
		err := os.Rename(from, to)
		if err == nil {
			return nil
		}
		if i >= attempts-1 || !isTransientRename(err) {
			return err
		}
		time.Sleep(time.Duration(25*(i+1)) * time.Millisecond)
	}
}

func isTransientRename(err error) bool {
	return errors.Is(err, os.ErrPermission) || errors.Is(err, fs.ErrPermission)
}
