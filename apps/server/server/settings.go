package server

import (
	"net/http"
	"os"
	"path/filepath"

	"perch/httpx"
	"perch/protocol"
	"perch/storage"
)

// A short list you scan beats a long one you read.
const recentMax = 10

func (s *Server) registerSettings() {
	s.handle("GET /api/settings", func(w http.ResponseWriter, r *http.Request) error {
		settings, err := storage.GetSettings()
		if err != nil {
			return err
		}
		return httpx.JSON(w, settings)
	})

	s.handle("PUT /api/settings", func(w http.ResponseWriter, r *http.Request) error {
		var patch protocol.SettingsPatch
		if err := httpx.DecodeJSON(r, &patch); err != nil {
			return err
		}
		current, err := storage.GetSettings()
		if err != nil {
			return err
		}

		var rootsChanged bool
		if patch.Workspaces != nil {
			next := *patch.Workspaces
			// Only what is being added: an existing root whose folder has since been deleted
			// should still be removable, and re-saving unrelated settings should not fail on it.
			added := difference(next, current.Workspaces)
			if err := checkRoots(added); err != nil {
				return err
			}
			removed := difference(current.Workspaces, next)
			patch.RecentWorkspaces = ptr(recents(added, removed, current.RecentWorkspaces))
			rootsChanged = true
		}

		saved, err := storage.SaveSettings(func(st *protocol.Settings) { applyPatch(st, patch) })
		if err != nil {
			return err
		}

		if rootsChanged {
			roots, err := s.WorkspaceRoots()
			if err != nil {
				roots = []string{}
			}
			if s.watcher != nil {
				s.watcher.SetRoots(roots)
			}
			s.bus.Publish(protocol.NewRootsEvent(roots))
		}
		return httpx.JSON(w, saved)
	})
}

// Unknown and ill-typed keys never reach here: they fail to decode into SettingsPatch and are
// left as nil, which the API documents as "ignored".
func applyPatch(st *protocol.Settings, p protocol.SettingsPatch) {
	if p.Autosave != nil {
		st.Autosave = *p.Autosave
	}
	if p.AutosaveDelayMs != nil {
		st.AutosaveDelayMs = *p.AutosaveDelayMs
	}
	if p.MaxRows != nil {
		st.MaxRows = *p.MaxRows
	}
	if p.StatementTimeout != nil {
		st.StatementTimeout = *p.StatementTimeout
	}
	if p.Workspaces != nil {
		st.Workspaces = *p.Workspaces
	}
	if p.Theme != nil && (*p.Theme == protocol.ThemeDark || *p.Theme == protocol.ThemeLight) {
		st.Theme = *p.Theme
	}
	if p.KeywordCase != nil {
		switch *p.KeywordCase {
		case protocol.KeywordPreserve, protocol.KeywordUpper, protocol.KeywordLower:
			st.KeywordCase = *p.KeywordCase
		}
	}
	if p.Onboarded != nil {
		st.Onboarded = *p.Onboarded
	}
	if p.RecentWorkspaces != nil {
		st.RecentWorkspaces = *p.RecentWorkspaces
	}
}

// A root has to be a directory that exists, because every other failure it causes is reported
// far away from the typo: an empty file list, a watcher with nothing to watch, a save that fails
// with a path error.
func checkRoots(roots []string) error {
	for _, root := range roots {
		if !filepath.IsAbs(root) {
			return httpx.BadRequest("Workspace path must be absolute: " + root)
		}
		// perch's own queries folder is perch's to make. Refusing to open it because it is not
		// there yet would be refusing to do the one thing that creates it.
		if filepath.Clean(root) == filepath.Clean(storage.DefaultQueriesDir()) {
			if err := os.MkdirAll(root, 0o700); err != nil {
				return err
			}
		}
		info, err := os.Stat(root)
		if err != nil {
			return httpx.BadRequest("No such folder: " + root)
		}
		if !info.IsDir() {
			return httpx.BadRequest("Not a folder: " + root)
		}
	}
	return nil
}

// Newest first, no duplicates, capped.
func recents(groups ...[]string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, recentMax)
	for _, group := range groups {
		for _, item := range group {
			if item == "" || seen[item] {
				continue
			}
			seen[item] = true
			out = append(out, item)
			if len(out) == recentMax {
				return out
			}
		}
	}
	return out
}

func difference(from, exclude []string) []string {
	out := make([]string, 0)
	for _, v := range from {
		if !slicesContains(exclude, v) {
			out = append(out, v)
		}
	}
	return out
}

func ptr[T any](v T) *T { return &v }
