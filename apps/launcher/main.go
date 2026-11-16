// PerchLauncher is the desktop window around the perch CLI installed beside it: it starts, opens,
// stops and updates Perch, and holds no server code of its own.
package main

import (
	"fmt"
	"os"
)

// Set by the linker from apps/server/package.json; see scripts/build.sh.
var Version = "dev"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "PerchLauncher:", err)
		os.Exit(1)
	}
}
