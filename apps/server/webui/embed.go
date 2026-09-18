// Package webui carries the built frontend inside the binary. The directory is filled by the build
// (apps/web's vite output is copied into webui/static by scripts/build.sh) and is empty in a source checkout, which is
// why every caller has to handle "no UI here".
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:static
var embedded embed.FS

// FS returns the embedded bundle, and false when this binary was built without one.
func FS() (fs.FS, bool) {
	sub, err := fs.Sub(embedded, "static")
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, false
	}
	return sub, true
}
