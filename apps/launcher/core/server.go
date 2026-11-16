package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"time"
)

// Perch drives the perch CLI. The launcher never talks to the server directly: everything goes
// through the commands a person would type, which keeps net/http out of the binary.
type Perch struct {
	Path string
	// Prepare adjusts every command before it runs; on Windows it keeps a console window from
	// flashing up for each call.
	Prepare func(*exec.Cmd)
}

// PerchBeside is the perch binary installed in the same folder as the launcher.
func PerchBeside(launcher string) string {
	name := "perch"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(filepath.Dir(launcher), name)
}

type Status struct {
	PID     int    `json:"pid"`
	URL     string `json:"url"`
	Version string `json:"version"`
}

func (p Perch) command(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, p.Path, args...)
	if p.Prepare != nil {
		p.Prepare(cmd)
	}
	return cmd
}

func (p Perch) run(timeout time.Duration, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var stdout, stderr bytes.Buffer
	cmd := p.command(ctx, args...)
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		for _, b := range [][]byte{stderr.Bytes(), stdout.Bytes()} {
			if line := lastLine(b); line != "" {
				return stdout.Bytes(), errors.New(line)
			}
		}
		return stdout.Bytes(), err
	}
	return stdout.Bytes(), nil
}

// Status is nil when no healthy server is running; `perch status --json` prints null then.
func (p Perch) Status() (*Status, error) {
	out, err := p.run(5*time.Second, "status", "--json")
	if err != nil {
		return nil, err
	}
	var st *Status
	if err := json.Unmarshal(out, &st); err != nil {
		return nil, err
	}
	if st == nil || st.URL == "" {
		return nil, nil
	}
	return st, nil
}

// Stop stops whichever server is running, wherever it was started.
func (p Perch) Stop() error {
	_, err := p.run(45*time.Second, "stop")
	return err
}

func (p Perch) Serve(port int, out *Output) *exec.Cmd {
	cmd := p.command(context.Background(), "serve", "--no-open", "--port", strconv.Itoa(port))
	cmd.Stdout, cmd.Stderr = out.stream(false), out.stream(true)
	return cmd
}
