package server

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"perch/protocol"
	"perch/storage"
)

const (
	DefaultPort = 4600
	DefaultHost = "127.0.0.1"
	// How many ports above the requested one we are willing to try.
	portScan = 10
)

type StartOptions struct {
	Port         int
	Host         string
	ExtraDirs    []string
	UIDir        string
	AllowOrigins []string
	Version      string
	// StrictPort fails on a busy port instead of scanning upwards.
	StrictPort bool
}

type Running struct {
	// URL is the bare origin, e.g. http://127.0.0.1:4600 — what to print and open.
	URL  string
	Host string
	Port int

	server *http.Server
	app    *Server
}

func Start(opts StartOptions) (*Running, error) {
	host := opts.Host
	if host == "" {
		host = DefaultHost
	}

	// First run has no workspace at all: create ~/.perch/queries and adopt it before anything
	// reads settings, so the file API, the watcher and the UI all start on a real folder.
	if _, err := storage.EnsureDefaultWorkspace(); err != nil {
		return nil, err
	}
	// --dir is applied by writing it to settings, the only place roots live. From here on it is
	// an ordinary workspace: it survives a restart, and it can be closed from the UI.
	if len(opts.ExtraDirs) > 0 {
		dirs := make([]string, 0, len(opts.ExtraDirs))
		for _, dir := range opts.ExtraDirs {
			if abs, err := filepath.Abs(dir); err == nil {
				dirs = append(dirs, abs)
			}
		}
		if _, err := storage.SaveSettings(func(s *protocol.Settings) {
			for _, dir := range dirs {
				if !slicesContains(s.Workspaces, dir) {
					s.Workspaces = append(s.Workspaces, dir)
				}
			}
		}); err != nil {
			return nil, err
		}
	}

	first := opts.Port
	if first == 0 && !opts.StrictPort {
		first = DefaultPort
	}
	attempts := portScan + 1
	if opts.StrictPort || first == 0 {
		attempts = 1
	}

	var listener net.Listener
	var port int
	var lastErr error
	for i := 0; i < attempts; i++ {
		candidate := first
		if first != 0 {
			candidate = first + i
		}
		l, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(candidate)))
		if err != nil {
			lastErr = err
			if !isAddrInUse(err) {
				return nil, err
			}
			continue
		}
		listener = l
		port = l.Addr().(*net.TCPAddr).Port
		break
	}
	if listener == nil {
		if opts.StrictPort {
			return nil, fmt.Errorf("port %d is already in use: %w", first, lastErr)
		}
		return nil, fmt.Errorf("ports %d-%d are all in use: %w", first, first+portScan, lastErr)
	}

	url := fmt.Sprintf("http://%s:%d", displayHost(host), port)
	app := New(Options{
		Version:      opts.Version,
		UIDir:        opts.UIDir,
		URL:          url,
		AllowOrigins: opts.AllowOrigins,
		Watch:        true,
	})
	httpServer := &http.Server{Handler: app.Handler()}

	go func() {
		if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintf(os.Stderr, "[perch] %v\n", err)
		}
	}()

	info := app.ServerInfo(os.Getpid())
	info.URL = url
	if err := storage.WriteServerInfo(info); err != nil {
		return nil, err
	}

	return &Running{URL: url, Host: host, Port: port, server: httpServer, app: app}, nil
}

func (r *Running) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := r.server.Shutdown(ctx)
	r.app.Close()
	_ = storage.ClearServerInfo()
	return err
}

func isAddrInUse(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE) || errors.Is(err, syscall.EACCES)
}

// Nobody can browse to 0.0.0.0.
func displayHost(host string) string {
	if host == "0.0.0.0" || host == "::" || host == "" {
		return "127.0.0.1"
	}
	if strings.Contains(host, ":") {
		return "[" + host + "]"
	}
	return host
}

func IsLoopback(host string) bool {
	return host == "127.0.0.1" || host == "localhost"
}
