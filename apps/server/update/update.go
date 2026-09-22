// Package update replaces the running binary with a newer release. The asset names, the
// download base and the checksums.txt layout it reads are the ones install.sh reads and
// .github/workflows/release.yml writes — the three move together or `perch update` breaks for
// everyone already running an older binary.
package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"perch/storage"
)

const (
	repo       = "Sahil1337/perch"
	latestAPI  = "https://api.github.com/repos/" + repo + "/releases/latest"
	releaseURL = "https://github.com/" + repo + "/releases/download"
	// ReleasesPage is where a platform without an asset has to go by hand.
	ReleasesPage = "https://github.com/" + repo + "/releases/latest"
)

// The five targets release.yml builds. Anything else has to build from source, and saying so
// beats a 404 on an asset that was never published.
var targets = map[string]bool{
	"darwin-arm64":  true,
	"darwin-amd64":  true,
	"linux-amd64":   true,
	"linux-arm64":   true,
	"windows-amd64": true,
}

// PERCH_DOWNLOAD_BASE=file:///path/to/release points every fetch at a local directory, which is
// how the installer is tested; the transport has to speak file:// for that to work here too.
var client = &http.Client{Transport: fileAwareTransport()}

func fileAwareTransport() http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.RegisterProtocol("file", http.NewFileTransport(http.Dir("/")))
	return transport
}

// Target is the os-arch pair that appears in every release asset name, e.g. darwin-arm64.
func Target() string { return runtime.GOOS + "-" + runtime.GOARCH }

// Supported reports whether this platform has a release asset at all.
func Supported() bool { return targets[Target()] }

// Latest is the tag of the newest published release, e.g. "v0.2.0". A draft release is not
// visible here, which is the same blind spot install.sh has.
func Latest(ctx context.Context) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, latestAPI, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/vnd.github+json")

	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github answered %s for the latest release", response.Status)
	}

	var body struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&body); err != nil {
		return "", err
	}
	if body.TagName == "" {
		return "", fmt.Errorf("no published release for %s", repo)
	}
	return body.TagName, nil
}

// Check is Latest with a cache, for the background look `perch serve` takes: within ttl of the
// last successful call it answers from ~/.perch/update.json and asks GitHub nothing.
func Check(ctx context.Context, ttl time.Duration) (string, error) {
	if cached, err := storage.ReadUpdateCheck(); err == nil && cached != nil {
		if at, err := time.Parse(time.RFC3339, cached.CheckedAt); err == nil && time.Since(at) < ttl {
			return cached.Latest, nil
		}
	}
	tag, err := Latest(ctx)
	if err != nil {
		return "", err
	}
	_ = storage.WriteUpdateCheck(storage.UpdateCheck{CheckedAt: time.Now().UTC().Format(time.RFC3339), Latest: tag})
	return tag, nil
}

// Disabled reports the PERCH_NO_UPDATE_CHECK opt-out, for the check perch makes on its own.
// An explicit `perch update` ignores it: the user asked.
func Disabled() bool { return os.Getenv("PERCH_NO_UPDATE_CHECK") != "" }

// IsNewer reports whether tag is a later version than the one this binary was built as.
func IsNewer(tag, current string) bool { return Compare(tag, current) > 0 }

// Compare orders two versions, with or without a leading v, by major.minor.patch. A prerelease
// suffix sorts below the release it precedes, as semver says, and below nothing else — perch
// does not ship them, so a careful answer costs three lines and a wrong one ships a downgrade.
func Compare(a, b string) int {
	aNum, aPre := parseVersion(a)
	bNum, bPre := parseVersion(b)
	for i := range aNum {
		if aNum[i] != bNum[i] {
			if aNum[i] < bNum[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case aPre == bPre:
		return 0
	case aPre == "":
		return 1
	case bPre == "":
		return -1
	}
	return strings.Compare(aPre, bPre)
}

func parseVersion(version string) ([3]int, string) {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	pre := ""
	if i := strings.IndexAny(version, "-+"); i >= 0 {
		pre, version = version[i+1:], version[:i]
	}
	var parts [3]int
	for i, field := range strings.SplitN(version, ".", 3) {
		parts[i], _ = strconv.Atoi(field)
	}
	return parts, pre
}
