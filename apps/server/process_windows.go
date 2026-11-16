package main

import (
	"errors"
	"fmt"
	"time"

	"golang.org/x/sys/windows"
)

func processAlive(pid int) bool {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return errors.Is(err, windows.ERROR_ACCESS_DENIED)
	}
	defer windows.CloseHandle(handle)
	event, err := windows.WaitForSingleObject(handle, 0)
	return err == nil && event == uint32(windows.WAIT_TIMEOUT)
}

// Windows has no SIGTERM to send, so the endpoint gets one more chance before the kill.
func stopByForce(pid int, url string) error {
	if requestShutdown(url) && waitForExit(pid, stopWait) {
		return nil
	}
	handle, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		if !processAlive(pid) {
			return nil
		}
		return fmt.Errorf("could not stop pid %d: %w", pid, err)
	}
	defer windows.CloseHandle(handle)
	if err := windows.TerminateProcess(handle, 1); err != nil {
		return fmt.Errorf("could not stop pid %d: %w", pid, err)
	}
	if event, _ := windows.WaitForSingleObject(handle, uint32((5 * time.Second).Milliseconds())); event != windows.WAIT_OBJECT_0 {
		return fmt.Errorf("pid %d did not exit after being terminated", pid)
	}
	return nil
}
