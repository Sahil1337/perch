// perch — a tiny local SQL client. See README.md for usage.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"perch/server"
	"perch/storage"
)

// Overridden at build time with -ldflags "-X main.Version=…".
var Version = "0.1.0"

const help = `perch v%s — a tiny local SQL client

usage: perch [command] [options]

commands:
  serve                 start the local server and open the UI (default command)
  stop                  stop the running server
  status                show whether the server is running

Run "perch <command> --help" for command-specific options. "perch --version" prints the version.
`

func main() {
	args := os.Args[1:]
	if len(args) > 0 {
		switch args[0] {
		case "--version", "-v":
			fmt.Println(Version)
			return
		case "--help", "-h":
			fmt.Printf(help, Version)
			return
		}
	}

	command := "serve"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		switch args[0] {
		case "serve", "stop", "status":
			command = args[0]
			rest = args[1:]
		default:
			fmt.Fprintf(os.Stderr, "unknown command: %s\n", args[0])
			fmt.Printf(help, Version)
			os.Exit(1)
		}
	}

	var err error
	switch command {
	case "serve":
		err = cmdServe(rest)
	case "stop":
		err = cmdStop(rest)
	case "status":
		err = cmdStatus(rest)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

// stringList is a flag that may be repeated.
type stringList []string

func (l *stringList) String() string     { return strings.Join(*l, ",") }
func (l *stringList) Set(v string) error { *l = append(*l, v); return nil }

func cmdServe(args []string) error {
	flags := flag.NewFlagSet("serve", flag.ExitOnError)
	port := flags.Int("port", server.DefaultPort, "port to listen on")
	host := flags.String("host", server.DefaultHost, "host to bind")
	noOpen := flags.Bool("no-open", false, "don't open the browser")
	uiDir := flags.String("ui", "", "serve a built UI from this directory")
	var dirs stringList
	var origins stringList
	flags.Var(&dirs, "dir", "add a workspace directory (repeatable, persisted)")
	flags.Var(&origins, "allow-origin", "let a UI dev server on another origin call the API (repeatable, dev only)")
	flags.Usage = func() {
		fmt.Print(`usage: perch [serve] [--port 4600] [--host 127.0.0.1] [--no-open] [--dir <path>]... [--ui <dir>]

Starts the local server (default command when no other command is given). If a live server is
already running (per ~/.perch/server.json), prints/opens its URL instead of starting another.

  --port <n>     port to listen on (default 4600)
  --host <host>  host to bind (default 127.0.0.1)
  --no-open      don't open the browser
  --dir <path>   add a workspace directory the file API may read/write (repeatable, persisted;
                 ~/.perch/queries is always there)
  --ui <dir>     serve a built UI from this directory instead of the embedded one
  --allow-origin <origin>  let a UI dev server on another origin call the API (repeatable, dev only)
`)
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	open := !*noOpen

	if existing, _ := storage.ReadServerInfo(); existing != nil {
		if healthy(existing.URL) {
			fmt.Printf("perch already running (pid %d) → %s\n", existing.PID, existing.URL)
			if open {
				openBrowser(existing.URL)
			}
			return nil
		}
		// Stale server.json from a crashed or killed process.
		_ = storage.ClearServerInfo()
	}

	running, err := server.Start(server.StartOptions{
		Port:         *port,
		Host:         *host,
		ExtraDirs:    dirs,
		UIDir:        resolveUIDir(*uiDir),
		AllowOrigins: origins,
		Version:      Version,
	})
	if err != nil {
		return err
	}

	fmt.Printf("perch v%s → %s\n", Version, running.URL)
	// There is no auth: binding past loopback publishes the API to whoever can route to it.
	if !server.IsLoopback(*host) {
		fmt.Printf("listening on %s: anyone who can reach this address can run queries\n", *host)
	}
	for _, origin := range origins {
		fmt.Printf("dev UI      → %s/\n", strings.TrimRight(origin, "/"))
	}
	if open {
		openBrowser(running.URL)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	return running.Close()
}

// A UI directory next to the binary wins over the embedded bundle: it is more current than
// whatever was built in. Without --ui, an installed layout with ui/ beside the executable still
// works the way the TypeScript build's package layout did.
func resolveUIDir(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	candidate := filepath.Join(filepath.Dir(exe), "ui")
	if info, err := os.Stat(candidate); err == nil && info.IsDir() {
		return candidate
	}
	return ""
}

func cmdStop(args []string) error {
	flags := flag.NewFlagSet("stop", flag.ExitOnError)
	flags.Usage = func() {
		fmt.Print("usage: perch stop\n\nSends SIGTERM to the running server (per server.json) and clears it.\n")
	}
	if err := flags.Parse(args); err != nil {
		return err
	}

	info, _ := storage.ReadServerInfo()
	if info == nil {
		fmt.Println("not running")
		return nil
	}
	if process, err := os.FindProcess(info.PID); err == nil && process.Signal(syscall.SIGTERM) == nil {
		fmt.Printf("stopped (pid %d)\n", info.PID)
	} else {
		fmt.Println("server.json was stale (process already gone)")
	}
	return storage.ClearServerInfo()
}

func cmdStatus(args []string) error {
	flags := flag.NewFlagSet("status", flag.ExitOnError)
	asJSON := flags.Bool("json", false, "print the server info as JSON")
	flags.Usage = func() {
		fmt.Print("usage: perch status [--json]\n\nPrints the running server info, or \"not running\".\n")
	}
	if err := flags.Parse(args); err != nil {
		return err
	}

	info, _ := storage.ReadServerInfo()
	if info == nil || !healthy(info.URL) {
		if info != nil {
			_ = storage.ClearServerInfo() // stale
		}
		if *asJSON {
			fmt.Println("null")
		} else {
			fmt.Println("not running")
		}
		return nil
	}
	if *asJSON {
		body, err := json.MarshalIndent(info, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(body))
		return nil
	}
	fmt.Printf("running · pid %d · %s · started %s\n", info.PID, info.URL, info.StartedAt)
	return nil
}

func healthy(url string) bool {
	client := &http.Client{Timeout: 800 * time.Millisecond}
	res, err := client.Get(url + "/api/health")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	return res.StatusCode >= 200 && res.StatusCode < 300
}

// Best-effort: never blocks the CLI and never fails it (no browser, no display).
func openBrowser(url string) {
	var command string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		command, args = "open", []string{url}
	case "windows":
		// cmd's start needs an (ignored) title argument before the URL.
		command, args = "cmd", []string{"/c", "start", "", url}
	default:
		command, args = "xdg-open", []string{url}
	}
	cmd := exec.Command(command, args...)
	if err := cmd.Start(); err == nil {
		go cmd.Wait()
	}
}
