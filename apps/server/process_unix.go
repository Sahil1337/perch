//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

func processAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = process.Signal(syscall.Signal(0))
	return err == nil || errors.Is(err, syscall.EPERM)
}

// SIGTERM reaches the same graceful path as /api/shutdown, so this never kills outright.
func stopByForce(pid int, _ string) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := process.Signal(syscall.SIGTERM); err != nil && processAlive(pid) {
		return fmt.Errorf("could not signal pid %d: %w", pid, err)
	}
	if !waitForExit(pid, stopWait) {
		return fmt.Errorf("pid %d did not exit within %s", pid, stopWait)
	}
	return nil
}
