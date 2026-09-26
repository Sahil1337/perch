package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"perch/fsx"
)

// maxAsset caps what a download may expand to. The binary is around 14 MB; the ceiling is here
// so a wrong URL cannot fill a disk.
const maxAsset = 256 << 20

// Apply downloads tag's asset for this platform, verifies it against the release's
// checksums.txt, and replaces the running binary with it. It returns the path it replaced.
// Progress goes to log, which may be nil.
func Apply(ctx context.Context, tag string, log func(string)) (string, error) {
	if log == nil {
		log = func(string) {}
	}
	if !Supported() {
		return "", fmt.Errorf("no release asset for %s — build from source, or see %s", Target(), ReleasesPage)
	}

	binaryPath, err := executablePath()
	if err != nil {
		return "", err
	}

	asset := assetName(tag)
	base := os.Getenv("PERCH_DOWNLOAD_BASE")
	if base == "" {
		base = releaseURL + "/" + tag
	}
	base = strings.TrimRight(base, "/")

	log("downloading " + asset)
	archive, err := fetch(ctx, base+"/"+asset)
	if err != nil {
		return "", fmt.Errorf("could not download %s: %w", asset, err)
	}

	// Unlike a first install, this overwrites a binary that already works, so an unverifiable
	// download is a refusal rather than a warning.
	sums, err := fetch(ctx, base+"/checksums.txt")
	if err != nil {
		return "", fmt.Errorf("could not fetch checksums.txt for %s: %w", tag, err)
	}
	if err := verify(archive, sums, asset); err != nil {
		return "", err
	}
	log("checksum ok")

	binary := archive
	if !strings.HasSuffix(asset, ".exe") {
		if binary, err = extractBinary(archive); err != nil {
			return "", err
		}
	}

	if err := replace(binaryPath, binary); err != nil {
		return "", err
	}
	return binaryPath, nil
}

// Windows ships the bare .exe; every other target is a tarball carrying the executable bit.
func assetName(tag string) string {
	version := strings.TrimPrefix(tag, "v")
	if runtime.GOOS == "windows" {
		return fmt.Sprintf("perch-%s-%s.exe", version, Target())
	}
	return fmt.Sprintf("perch-%s-%s.tar.gz", version, Target())
}

func fetch(ctx context.Context, url string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, maxAsset))
}

// checksums.txt lists every asset in the release; only the line for ours matters.
func verify(data, sums []byte, asset string) error {
	want := ""
	for _, line := range strings.Split(string(sums), "\n") {
		digest, name, found := strings.Cut(strings.TrimSpace(line), " ")
		if !found {
			continue
		}
		// sha256sum writes "<digest>  <name>", with a "*" before the name in binary mode.
		if strings.TrimPrefix(strings.TrimSpace(name), "*") == asset {
			want = digest
			break
		}
	}
	if want == "" {
		return fmt.Errorf("checksums.txt does not list %s", asset)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != want {
		return fmt.Errorf("checksum mismatch for %s (expected %s, got %s) — refusing to install", asset, want, got)
	}
	return nil
}

func extractBinary(archive []byte) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, err
	}
	defer gz.Close()

	// The tarball is packed from a staging directory, so entries arrive as ./perch, ./LICENSE
	// and ./README.md. The binary is the one named perch, wherever in the tree it sits.
	reader := tar.NewReader(gz)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if header.Typeflag != tar.TypeReg || filepath.Base(header.Name) != "perch" {
			continue
		}
		return io.ReadAll(io.LimitReader(reader, maxAsset))
	}
	return nil, errors.New("the archive did not contain a perch binary")
}

// executablePath follows symlinks so an update rewrites the real binary rather than turning a
// link into a copy of it.
func executablePath() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("could not find the running binary: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved, nil
	}
	return path, nil
}

func replace(binaryPath string, binary []byte) error {
	if runtime.GOOS == "windows" {
		return replaceWindows(binaryPath, binary)
	}
	// A rename over a running executable is fine on Unix: this process keeps the old inode
	// until it exits, and the next `perch` is the new one.
	if err := fsx.WriteAtomic(binaryPath, binary, 0o755); err != nil {
		return writeError(binaryPath, err)
	}
	return nil
}

// Windows will not rename over a file that is open, and the file here is this process. Moving
// the running binary aside first is allowed, and the stale copy goes on the next run.
func replaceWindows(binaryPath string, binary []byte) error {
	previous := binaryPath + ".old"
	_ = os.Remove(previous)
	if err := os.Rename(binaryPath, previous); err != nil {
		return writeError(binaryPath, err)
	}
	// Staged in the target directory and renamed into place: a write that dies halfway would
	// otherwise leave a truncated perch.exe where the binary belongs.
	if err := fsx.WriteAtomic(binaryPath, binary, 0o755); err != nil {
		if restore := os.Rename(previous, binaryPath); restore != nil {
			return fmt.Errorf("could not replace %s: %w — the previous binary is still at %s",
				binaryPath, err, previous)
		}
		return writeError(binaryPath, err)
	}
	_ = os.Remove(previous)
	return nil
}

func writeError(binaryPath string, err error) error {
	if errors.Is(err, fs.ErrPermission) {
		return fmt.Errorf("cannot write %s — re-run with sudo, or reinstall into a directory you own:\n"+
			"  curl -fsSL https://raw.githubusercontent.com/%s/main/install.sh | PERCH_INSTALL_DIR=$HOME/.local/bin sh",
			filepath.Dir(binaryPath), repo)
	}
	return fmt.Errorf("could not replace %s: %w", binaryPath, err)
}
