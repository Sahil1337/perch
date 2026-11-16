package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	StateReady    = "ready"
	StateStarting = "starting"
	StateRunning  = "running"
	StateError    = "error"

	// RelaunchFlag marks the launcher started after an update, which waits for the old one to
	// exit instead of handing focus to it.
	RelaunchFlag = "--after-update"

	startTimeout = 15 * time.Second
	pollEvery    = 500 * time.Millisecond
)

// Host is the one OS-specific piece: the window, and the few calls that differ per platform.
// Every method may be called from any goroutine.
type Host interface {
	Eval(script string)
	OpenURL(url string) error
	Notify(title, body string)
	ShowLog(text string)
	// Contain ties a spawned server's lifetime to the launcher's, so a launcher crash cannot
	// leave a headless server behind.
	Contain(*os.Process) error
	Prepare(*exec.Cmd)
	Quit()
}

// View is the whole page state; every PerchLauncher.set carries all of it.
type View struct {
	State        string `json:"state"`
	Port         int    `json:"port"`    // the setting
	Address      string `json:"address"` // host:port the running server took; empty unless running
	Error        string `json:"error"`
	Update       string `json:"update"`
	Version      string `json:"version"`
	AutoLaunch   bool   `json:"autoLaunch"`
	CheckUpdates bool   `json:"checkUpdates"`
	Paused       bool   `json:"paused"`
}

type App struct {
	perch   Perch
	version string
	self    string
	host    Host

	// pubMu keeps snapshot, marshal and Eval in one order without holding mu while the page runs.
	pubMu sync.Mutex
	// saveMu makes reading settings and writing them one step, so an older snapshot never lands last.
	saveMu sync.Mutex

	mu        sync.Mutex
	settings  Settings
	state     string
	url       string
	errMsg    string
	update    string
	notified  string
	paused    bool
	known     bool // the first status answer is in
	pageReady bool
	busy      bool   // a launch, stop or update is running
	gen       uint64 // bumped on every lifecycle change; a status read before one must not land after it
	exited    bool   // our server exited while busy; launch checks it before committing running
	checking  bool
	closing   bool
	child     *exec.Cmd
	childDone chan struct{}
	out       *Output
}

// New takes the launcher's own path up front: after `perch update` swaps the exe, the running
// image may report its renamed .old path.
func New(self, version string) *App {
	return &App{
		perch:    Perch{Path: PerchBeside(self)},
		version:  version,
		self:     self,
		settings: LoadSettings(),
		state:    StateReady,
		out:      NewOutput(),
	}
}

// Start decides the first state from `perch status`, then runs launchOnOpen and the daily update
// check. Nothing keeps running after that: no tickers, no polling while idle.
func (a *App) Start(h Host) {
	a.host = h
	a.perch.Prepare = h.Prepare
	go func() {
		st, _ := a.perch.Status()
		a.mu.Lock()
		if st != nil {
			a.state, a.url = StateRunning, st.URL
			a.gen++
		}
		a.known = true
		launch := st == nil && a.settings.LaunchOnOpen
		a.mu.Unlock()
		a.push()
		if launch {
			a.launch(0)
		}
		a.checkUpdates(false)
	}()
}

type message struct {
	Action string          `json:"action"`
	Data   json.RawMessage `json:"data"`
}

// Handle takes one page message as JSON. It returns quickly; anything slow runs on its own
// goroutine.
func (a *App) Handle(raw []byte) {
	var m message
	// A page that stringified its message arrives as a JSON string.
	var s string
	if json.Unmarshal(raw, &s) == nil {
		raw = []byte(s)
	}
	if json.Unmarshal(raw, &m) != nil {
		return
	}
	switch m.Action {
	case "ready-for-state":
		a.mu.Lock()
		a.pageReady = true
		a.mu.Unlock()
		a.push()
	case "launch", "retry":
		var d struct{ Port int }
		_ = json.Unmarshal(m.Data, &d)
		go a.launch(d.Port)
	case "open":
		go a.open()
	case "stop":
		go a.stop()
	case "show-log":
		text := a.currentOutput().Text()
		if text == "" {
			text = "Nothing captured yet. The log shows the output of the last server this window started."
		}
		a.host.ShowLog(text)
	case "settings":
		a.applySettings(m.Data)
	case "check-updates":
		go a.checkUpdates(true)
	case "open-update":
		go a.applyUpdate()
	}
}

// SetPaused tells the page it was minimised or restored, so it can stop its animations.
func (a *App) SetPaused(paused bool) {
	a.mu.Lock()
	a.paused = paused
	a.mu.Unlock()
	a.push()
}

// Close runs when the window closes: closing the launcher always stops Perch, including a
// server started from a terminal.
func (a *App) Close() {
	a.mu.Lock()
	a.closing = true
	a.mu.Unlock()
	_ = a.perch.Stop()
	a.waitChild(3 * time.Second)
}

func (a *App) view() View {
	v := View{
		State:        a.state,
		Port:         a.settings.Port,
		Error:        a.errMsg,
		Update:       a.update,
		Version:      a.version,
		AutoLaunch:   a.settings.LaunchOnOpen,
		CheckUpdates: a.settings.CheckUpdates,
		Paused:       a.paused,
	}
	if a.state == StateRunning {
		_, rest, _ := strings.Cut(a.url, "://")
		v.Address, _, _ = strings.Cut(rest, "/")
	}
	return v
}

// push relies on Host.Eval running scripts in call order.
func (a *App) push() {
	a.pubMu.Lock()
	defer a.pubMu.Unlock()
	a.mu.Lock()
	ready := a.known && a.pageReady && a.host != nil
	v := a.view()
	a.mu.Unlock()
	if !ready {
		return
	}
	body, _ := json.Marshal(v)
	a.host.Eval(`typeof PerchLauncher!=="undefined"&&PerchLauncher.set(` + string(body) + `)`)
}

func (a *App) currentOutput() *Output {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.out
}

// begin claims the single slot for a long operation.
func (a *App) begin() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.busy || a.closing {
		return false
	}
	a.busy = true
	a.gen++
	return true
}

func (a *App) end() uint64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.busy = false
	a.gen++
	return a.gen
}

func (a *App) launch(port int) {
	a.mu.Lock()
	if a.busy || a.closing || a.state == StateRunning || a.state == StateStarting {
		a.mu.Unlock()
		return
	}
	if !validPort(port) {
		port = a.settings.Port
	}
	a.busy, a.exited = true, false
	a.gen++
	a.state, a.errMsg = StateStarting, ""
	a.out = NewOutput()
	out := a.out
	a.mu.Unlock()
	a.push()

	url, err := a.start(port, out)

	a.mu.Lock()
	if err == nil && a.exited {
		// Our server exited after answering; watch left that to us. It is gone for good, so one
		// more status read is final: perch serve also exits when another server was already up.
		a.mu.Unlock()
		if st, _ := a.perch.Status(); st != nil {
			url = st.URL
		} else {
			err = errors.New(exitMessage(out))
		}
		a.mu.Lock()
	}
	a.busy = false
	a.gen++
	if a.closing {
		a.mu.Unlock()
		return
	}
	if err != nil {
		a.state, a.errMsg, a.url = StateError, err.Error(), ""
	} else {
		a.state, a.url = StateRunning, url
	}
	a.mu.Unlock()
	a.push()
	if err == nil {
		_ = a.host.OpenURL(url)
	}
}

func (a *App) start(port int, out *Output) (string, error) {
	if _, err := os.Stat(a.perch.Path); err != nil {
		return "", errors.New("perch.exe was not found next to PerchLauncher.exe")
	}
	cmd := a.perch.Serve(port, out)
	if err := cmd.Start(); err != nil {
		return "", err
	}
	if err := a.host.Contain(cmd.Process); err != nil {
		fmt.Fprintf(out.stream(false), "launcher: could not tie the server to this window: %v\n", err)
	}
	done := make(chan struct{})
	a.mu.Lock()
	a.child, a.childDone = cmd, done
	a.mu.Unlock()
	go a.watch(cmd, done)

	deadline := time.NewTimer(startTimeout)
	defer deadline.Stop()
	poll := time.NewTicker(pollEvery)
	defer poll.Stop()
	for {
		select {
		case <-done:
			// perch serve also exits cleanly when it finds a server already up instead of
			// starting one, so the exit alone is not a failure.
			if st, _ := a.perch.Status(); st != nil {
				return st.URL, nil
			}
			if line := out.LastError(); line != "" {
				return "", errors.New(line)
			}
			if cmd.ProcessState != nil && !cmd.ProcessState.Success() {
				return "", fmt.Errorf("perch serve exited (%s)", cmd.ProcessState)
			}
			return "", errors.New("perch serve exited before the server answered")
		case <-poll.C:
			if a.isClosing() {
				return "", errors.New("closing")
			}
			if st, _ := a.perch.Status(); st != nil {
				return st.URL, nil
			}
		case <-deadline.C:
			// It never answered, so no request can be mid-write; nothing is lost by killing it.
			_ = cmd.Process.Kill()
			if line := out.LastError(); line != "" {
				return "", errors.New(line)
			}
			return "", fmt.Errorf("Perch didn't answer within %d seconds", int(startTimeout/time.Second))
		}
	}
}

// watch reaps the server and notices when it dies on its own while the window shows it running.
func (a *App) watch(cmd *exec.Cmd, done chan struct{}) {
	_ = cmd.Wait()
	a.mu.Lock()
	unexpected := false
	if a.child == cmd {
		a.child, a.childDone = nil, nil
		a.exited = a.busy
		unexpected = !a.busy && !a.closing && a.state == StateRunning
		if unexpected {
			a.state, a.url, a.errMsg = StateError, "", exitMessage(a.out)
			a.gen++
		}
	}
	a.mu.Unlock()
	close(done)
	if unexpected {
		a.push()
	}
}

func exitMessage(out *Output) string {
	if line := out.LastError(); line != "" {
		return line
	}
	return "Perch stopped unexpectedly"
}

func (a *App) waitChild(limit time.Duration) {
	a.mu.Lock()
	done := a.childDone
	a.mu.Unlock()
	if done == nil {
		return
	}
	select {
	case <-done:
	case <-time.After(limit):
	}
}

func (a *App) isClosing() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.closing
}

func (a *App) open() {
	a.mu.Lock()
	gen := a.gen
	a.mu.Unlock()
	st, _ := a.perch.Status()
	if st != nil {
		_ = a.host.OpenURL(st.URL)
	}
	a.refresh(st, gen)
}

func (a *App) stop() {
	if !a.begin() {
		return
	}
	_ = a.perch.Stop()
	a.waitChild(5 * time.Second)
	st, _ := a.perch.Status()
	a.refresh(st, a.end())
}

// refresh moves the state to what `perch status` reported, unless an operation is in flight or
// the state changed since gen was read.
func (a *App) refresh(st *Status, gen uint64) {
	a.mu.Lock()
	if a.busy || a.closing || a.gen != gen {
		a.mu.Unlock()
		return
	}
	switch {
	case st != nil:
		a.state, a.url, a.errMsg = StateRunning, st.URL, ""
	case a.state == StateRunning:
		a.state, a.url = StateReady, ""
	}
	a.mu.Unlock()
	a.push()
}

func (a *App) applySettings(raw json.RawMessage) {
	var d struct {
		AutoLaunch   *bool `json:"autoLaunch"`
		Port         *int  `json:"port"`
		CheckUpdates *bool `json:"checkUpdates"`
	}
	if json.Unmarshal(raw, &d) != nil {
		return
	}
	a.mu.Lock()
	if d.AutoLaunch != nil {
		a.settings.LaunchOnOpen = *d.AutoLaunch
	}
	if d.Port != nil && validPort(*d.Port) {
		a.settings.Port = *d.Port
	}
	turnedOn := d.CheckUpdates != nil && *d.CheckUpdates && !a.settings.CheckUpdates
	if d.CheckUpdates != nil {
		a.settings.CheckUpdates = *d.CheckUpdates
	}
	if !a.settings.CheckUpdates {
		a.update = ""
	}
	a.mu.Unlock()
	a.saveSettings()
	a.push()
	if turnedOn {
		go a.checkUpdates(false)
	}
}

func (a *App) checkUpdates(force bool) {
	now := time.Now()
	a.mu.Lock()
	if a.checking || (!force && !updateDue(a.settings, now)) {
		a.mu.Unlock()
		return
	}
	a.checking = true
	a.mu.Unlock()

	info, err := a.perch.CheckUpdate()

	a.mu.Lock()
	a.checking = false
	if err != nil {
		a.mu.Unlock()
		return
	}
	a.settings.LastUpdateCheck = now
	notify := false
	// Checks may have been turned off while this one ran; then only "Check now" still reports.
	if force || a.settings.CheckUpdates {
		a.update = ""
		if info.Available && info.Latest != "" {
			a.update = info.Latest
			notify = a.notified != info.Latest
			a.notified = info.Latest
		}
	}
	a.mu.Unlock()
	a.saveSettings()
	a.push()
	if notify {
		a.host.Notify("Perch "+displayVersion(info.Latest)+" is available",
			"Open Perch — SQL Client and click the version link to update.")
	}
}

func (a *App) saveSettings() {
	a.saveMu.Lock()
	defer a.saveMu.Unlock()
	a.mu.Lock()
	s := a.settings
	a.mu.Unlock()
	_ = SaveSettings(s)
}

// applyUpdate stops Perch, lets `perch update` swap both executables, then hands over to the new
// launcher.
func (a *App) applyUpdate() {
	if !a.begin() {
		return
	}
	_ = a.perch.Stop()
	a.waitChild(5 * time.Second)
	err := a.perch.Update()
	if err == nil {
		next := exec.Command(a.self, RelaunchFlag)
		err = next.Start()
		if err == nil {
			_ = next.Process.Release()
			a.mu.Lock()
			a.closing = true
			a.mu.Unlock()
			a.host.Quit()
			return
		}
	}
	a.mu.Lock()
	a.busy = false
	a.gen++
	a.state, a.url, a.errMsg = StateError, "", "Update failed: "+err.Error()
	a.mu.Unlock()
	a.push()
}
