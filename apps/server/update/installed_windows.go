package update

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const (
	launcherName = "PerchLauncher.exe"
	uninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\Perch`
)

// The installer puts PerchLauncher.exe beside perch.exe, and that is the whole test: a bare
// perch.exe from Downloads has no launcher to keep in step and no Add/Remove Programs entry.
// The launcher is downloaded and verified before perch.exe is touched, and staged on disk rather
// than in memory. The returned func swaps it in once perch.exe is replaced (true) or discards it
// (false); it is nil for a bare binary.
func prepareInstalled(ctx context.Context, base, tag string, sums []byte, binaryPath string, log func(string)) (func(bool) error, error) {
	dir := filepath.Dir(binaryPath)
	launcherPath := filepath.Join(dir, launcherName)
	if _, err := os.Stat(launcherPath); err != nil {
		return nil, nil
	}

	version := strings.TrimPrefix(tag, "v")
	asset := fmt.Sprintf("perch-launcher-%s-%s.exe", version, Target())
	log("downloading " + asset)
	staged, digest, err := download(ctx, base+"/"+asset, dir)
	if err != nil {
		return nil, fmt.Errorf("could not download %s: %w", asset, err)
	}
	if err := verifyDigest(digest, sums, asset); err != nil {
		os.Remove(staged)
		return nil, err
	}
	log("checksum ok")

	return func(commit bool) error {
		defer os.Remove(staged)
		if !commit {
			return nil
		}
		// The launcher is usually the process that ran this update, so it is moved aside like
		// perch.exe rather than overwritten.
		if err := swapRunning(launcherPath, func() error { return os.Rename(staged, launcherPath) }); err != nil {
			return fmt.Errorf("perch.exe was updated but %s was not: %w", launcherName, err)
		}
		log("replaced " + launcherName)
		// Cosmetic: a stale Add/Remove Programs version is not worth failing an update over.
		if err := setDisplayVersion(version); err != nil {
			log("could not update the Add/Remove Programs version: " + err.Error())
		}
		return nil
	}, nil
}

func setDisplayVersion(version string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, uninstallKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue("DisplayVersion", version)
}
