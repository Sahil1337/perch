package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"

	"perch/protocol"
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

// recordedAlive reports errNotPerch when the recorded PID has gone to another program: Windows
// reuses PIDs, and a crashed server leaves its server.json behind.
func recordedAlive(info protocol.ServerInfo) (bool, error) {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(info.PID))
	if err != nil {
		return errors.Is(err, windows.ERROR_ACCESS_DENIED), nil
	}
	defer windows.CloseHandle(handle)
	if event, err := windows.WaitForSingleObject(handle, 0); err != nil || event != uint32(windows.WAIT_TIMEOUT) {
		return false, nil
	}
	return true, verifyPerch(handle, info.StartedAt)
}

// Windows has no SIGTERM to send, so the endpoint gets one more chance before the kill. The kill
// goes through the handle that was verified, so the PID cannot change hands in between.
func stopByForce(info protocol.ServerInfo) error {
	pid := info.PID
	if requestShutdown(info.URL) && waitForExit(pid, stopWait) {
		return nil
	}
	handle, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		if !processAlive(pid) {
			return nil
		}
		return fmt.Errorf("could not stop pid %d: %w", pid, err)
	}
	defer windows.CloseHandle(handle)
	if err := verifyPerch(handle, info.StartedAt); err != nil {
		if errors.Is(err, errNotPerch) {
			return err
		}
		return fmt.Errorf("could not confirm pid %d is perch, so it was left running: %w", pid, err)
	}
	if err := windows.TerminateProcess(handle, 1); err != nil {
		return fmt.Errorf("could not stop pid %d: %w", pid, err)
	}
	if event, _ := windows.WaitForSingleObject(handle, uint32((5 * time.Second).Milliseconds())); event != windows.WAIT_OBJECT_0 {
		return fmt.Errorf("pid %d did not exit after being terminated", pid)
	}
	return nil
}

// verifyPerch checks the image name, which survives `perch update` as perch.exe.old and the bare
// release asset as perch-<v>-windows-amd64.exe, and that the process is not younger than the
// record it is supposed to have written.
func verifyPerch(handle windows.Handle, startedAt string) error {
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(handle, 0, &buf[0], &n); err != nil {
		return err
	}
	name := strings.TrimSuffix(strings.ToLower(filepath.Base(windows.UTF16ToString(buf[:n]))), ".old")
	if name != "perch.exe" && !(strings.HasPrefix(name, "perch-") && strings.HasSuffix(name, ".exe")) {
		return errNotPerch
	}
	started, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return nil
	}
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
		return err
	}
	if time.Unix(0, created.Nanoseconds()).After(started.Add(2 * time.Second)) {
		return errNotPerch
	}
	return nil
}
