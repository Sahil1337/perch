//go:build !windows

package main

import "errors"

// A macOS host is a host_darwin.go and a .dmg step away; core/ and webui/ already run anywhere.
func run() error {
	return errors.New("the launcher is Windows-only for now; run `perch` directly")
}
