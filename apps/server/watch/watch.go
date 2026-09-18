// Package watch reports workspace changes through the operating system's own notifications
// (FSEvents, inotify, ReadDirectoryChangesW) via fsnotify.
//
// The watcher is a hint for the UI. Save safety comes from the ifModifiedAt check in
// PUT /api/files/content, so a dropped or coalesced event can never cost anyone their work.
//
// Unlike Node's fs.watch, fsnotify does not watch recursively on any platform: every directory
// under a root is added individually, and directories created later are added as they appear.
package watch

import (
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"perch/protocol"
)

const (
	// A save fires several raw events within a few ms; flush once per path this long after the
	// first.
	coalesceWindow = 40 * time.Millisecond
	// How long an ExpectWrite/ExpectDelete hint may suppress an echo before it is discarded.
	expectTTL = 2 * time.Second
)

var skippedDirs = map[string]bool{
	"node_modules": true, "dist": true, "build": true, "target": true, "__pycache__": true,
}

// macOS and Windows compare paths case-insensitively; Linux does not.
var caseInsensitive = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

func key(full string) string {
	resolved, err := filepath.Abs(full)
	if err != nil {
		resolved = full
	}
	if caseInsensitive {
		return strings.ToLower(resolved)
	}
	return resolved
}

type expectation struct {
	modifiedAt string
	at         time.Time
}

type Watcher struct {
	onEvent func(protocol.FileEvent)

	mu      sync.Mutex
	fsw     *fsnotify.Watcher
	roots   map[string]string // key(root) -> root
	watched map[string]bool   // key(dir) -> added to fsnotify
	pending map[string]*time.Timer
	// Everything seen so far, so a first sighting can be flagged created and a vanished path
	// can be reported with the kind it used to have.
	known           map[string]string // key -> "file" | "dir"
	expectedWrites  map[string]expectation
	expectedDeletes map[string]time.Time
	closed          bool
	warned          bool
}

func New(onEvent func(protocol.FileEvent)) *Watcher {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("[perch] cannot start the file watcher: %v. Live file sync is off; saving is still safe (the mtime check is authoritative).", err)
		return nil
	}
	w := &Watcher{
		onEvent:         onEvent,
		fsw:             fsw,
		roots:           map[string]string{},
		watched:         map[string]bool{},
		pending:         map[string]*time.Timer{},
		known:           map[string]string{},
		expectedWrites:  map[string]expectation{},
		expectedDeletes: map[string]time.Time{},
	}
	go w.loop()
	return w
}

// SetRoots diffs roots against what is already watched and returns the roots actually watched.
func (w *Watcher) SetRoots(roots []string) []string {
	if w == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}

	wanted := make(map[string]string, len(roots))
	for _, root := range roots {
		wanted[key(root)] = root
	}

	for k, root := range w.roots {
		if _, ok := wanted[k]; ok {
			continue
		}
		delete(w.roots, k)
		w.unwatchTree(root)
	}
	for k, root := range wanted {
		if _, ok := w.roots[k]; ok {
			continue
		}
		if !w.watchTree(root) {
			continue
		}
		w.roots[k] = root
	}

	out := make([]string, 0, len(w.roots))
	for _, root := range w.roots {
		out = append(out, root)
	}
	return out
}

// watchTree adds root and every directory under it. Reports whether the root itself was added.
func (w *Watcher) watchTree(root string) bool {
	if err := w.addDir(root); err != nil {
		w.warnOnce(root, err)
		return false
	}
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() || path == root {
			return nil
		}
		name := d.Name()
		if strings.HasPrefix(name, ".") || skippedDirs[name] {
			return filepath.SkipDir
		}
		_ = w.addDir(path)
		return nil
	})
	return true
}

func (w *Watcher) addDir(dir string) error {
	k := key(dir)
	if w.watched[k] {
		return nil
	}
	if err := w.fsw.Add(dir); err != nil {
		return err
	}
	w.watched[k] = true
	return nil
}

func (w *Watcher) unwatchTree(root string) {
	prefix := key(root)
	for k := range w.watched {
		if k == prefix || strings.HasPrefix(k, prefix+string(filepath.Separator)) {
			_ = w.fsw.Remove(k)
			delete(w.watched, k)
		}
	}
}

// ExpectWrite tells the watcher that we just wrote fullPath and produced modifiedAt, so the
// matching echo is dropped instead of being reported back to the client that caused it.
func (w *Watcher) ExpectWrite(fullPath, modifiedAt string) {
	if w == nil || modifiedAt == "" {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	k := key(fullPath)
	w.expectedWrites[k] = expectation{modifiedAt: modifiedAt, at: time.Now()}
	w.known[k] = "file" // our own create counts as having seen the path
}

// ExpectDelete is the same, for a path the API removed (DELETE, or the old name of a rename).
func (w *Watcher) ExpectDelete(fullPath string) {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	k := key(fullPath)
	w.expectedDeletes[k] = time.Now()
	delete(w.expectedWrites, k)
}

func (w *Watcher) Close() {
	if w == nil {
		return
	}
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	w.closed = true
	for _, timer := range w.pending {
		timer.Stop()
	}
	w.pending = map[string]*time.Timer{}
	w.mu.Unlock()
	_ = w.fsw.Close()
}

func (w *Watcher) loop() {
	for {
		select {
		case event, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			w.onRaw(event)
		case err, ok := <-w.fsw.Errors:
			if !ok {
				return
			}
			// ENOSPC (inotify watch limit), EMFILE, or a root removed underneath us.
			w.warnOnce("a workspace", err)
		}
	}
}

func (w *Watcher) onRaw(event fsnotify.Event) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	full := event.Name
	if full == "" || !w.insideAWatchedRoot(full) {
		return
	}
	// A new directory needs its own watch, and anything already created inside it would
	// otherwise be missed.
	if event.Has(fsnotify.Create) {
		if info, err := os.Stat(full); err == nil && info.IsDir() {
			name := filepath.Base(full)
			if !strings.HasPrefix(name, ".") && !skippedDirs[name] {
				w.watchTree(full)
			}
		}
	}
	w.schedule(full)
}

// insideAWatchedRoot also applies the hidden and skipped-directory policy to every segment
// between the root and the path.
func (w *Watcher) insideAWatchedRoot(full string) bool {
	for _, root := range w.roots {
		rel, err := filepath.Rel(root, full)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
			continue
		}
		ok := true
		for _, segment := range strings.Split(rel, string(filepath.Separator)) {
			if strings.HasPrefix(segment, ".") || skippedDirs[segment] {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

// The first raw event for a path opens a window; later ones inside it fold into the same flush.
func (w *Watcher) schedule(full string) {
	k := key(full)
	if _, ok := w.pending[k]; ok {
		return
	}
	w.pending[k] = time.AfterFunc(coalesceWindow, func() {
		w.mu.Lock()
		delete(w.pending, k)
		w.mu.Unlock()
		w.flush(full)
	})
}

// flush asks the filesystem what the path looks like now, which is why an editor's
// temp-file-plus-rename save reads as one change rather than a delete and a create.
func (w *Watcher) flush(full string) {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	w.mu.Unlock()

	k := key(full)
	name := filepath.Base(full)
	info, statErr := os.Stat(full)

	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}

	var emit *protocol.FileEvent
	switch {
	case statErr == nil && info.IsDir():
		w.known[k] = "dir"
		event := protocol.NewDirEvent(full, name, false)
		emit = &event

	case statErr == nil && info.Mode().IsRegular():
		if !strings.HasSuffix(strings.ToLower(name), ".sql") {
			w.mu.Unlock()
			return
		}
		modifiedAt := protocol.ISOTime(info.ModTime())
		if w.takeExpectedWrite(k, modifiedAt) {
			w.mu.Unlock()
			return
		}
		_, seen := w.known[k]
		w.known[k] = "file"
		event := protocol.NewFileChange(full, name, modifiedAt, info.Size(), !seen)
		emit = &event

	default:
		kind := w.known[k]
		delete(w.known, k)
		if w.takeExpectedDelete(k) {
			w.mu.Unlock()
			return
		}
		if kind == "dir" {
			w.unwatchTree(full)
			event := protocol.NewDirEvent(full, name, true)
			emit = &event
		} else if strings.HasSuffix(strings.ToLower(name), ".sql") {
			event := protocol.NewFileDelete(full, name)
			emit = &event
		}
	}
	w.mu.Unlock()

	if emit != nil && w.onEvent != nil {
		w.onEvent(*emit)
	}
}

func (w *Watcher) takeExpectedWrite(k, modifiedAt string) bool {
	hint, ok := w.expectedWrites[k]
	if !ok {
		return false
	}
	delete(w.expectedWrites, k)
	// An expired hint is discarded rather than trusted: a lost event must not poison a real
	// change.
	if time.Since(hint.at) > expectTTL {
		return false
	}
	return hint.modifiedAt == modifiedAt
}

func (w *Watcher) takeExpectedDelete(k string) bool {
	at, ok := w.expectedDeletes[k]
	if !ok {
		return false
	}
	delete(w.expectedDeletes, k)
	return time.Since(at) <= expectTTL
}

func (w *Watcher) warnOnce(root string, err error) {
	if w.warned {
		return
	}
	w.warned = true
	log.Printf("[perch] cannot watch %s: %v. Live file sync is off for it; saving is still safe (the mtime check is authoritative).", root, err)
}
