// Package webui holds the launcher's whole interface: one hand-written HTML file.
package webui

import _ "embed"

//go:embed index.html
var Index string
