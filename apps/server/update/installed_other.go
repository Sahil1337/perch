//go:build !windows

package update

import "context"

// Only the Windows installer lays down more than the one binary.
func prepareInstalled(context.Context, string, string, []byte, string, func(string)) (func(bool) error, error) {
	return nil, nil
}
