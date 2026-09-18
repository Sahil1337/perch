package storage

import (
	"os"

	"perch/protocol"
)

func DefaultSettings() protocol.Settings {
	return protocol.Settings{
		Autosave:         true,
		AutosaveDelayMs:  1200,
		MaxRows:          1000,
		StatementTimeout: 0,
		Workspaces:       []string{},
		Theme:            protocol.ThemeDark,
		KeywordCase:      protocol.KeywordLower,
		Onboarded:        false,
		RecentWorkspaces: []string{},
	}
}

var settingsStore = NewStore(SettingsFile, 0o644, DefaultSettings)

func GetSettings() (protocol.Settings, error) {
	s, err := settingsStore.Read()
	if err != nil {
		return DefaultSettings(), err
	}
	// `system` was a third theme once, and a settings.json written by that build is still on
	// disk somewhere. Anything that is not `light` reads as the default.
	if s.Theme != protocol.ThemeLight {
		s.Theme = protocol.ThemeDark
	}
	if s.Workspaces == nil {
		s.Workspaces = []string{}
	}
	if s.RecentWorkspaces == nil {
		s.RecentWorkspaces = []string{}
	}
	return s, nil
}

func SaveSettings(apply func(*protocol.Settings)) (protocol.Settings, error) {
	current, err := GetSettings()
	if err != nil {
		return current, err
	}
	apply(&current)
	if err := settingsStore.Write(current); err != nil {
		return current, err
	}
	return current, nil
}

// EnsureDefaultWorkspace runs once at server start. With no workspace the file API, the watcher
// and the UI have nothing to point at, so perch creates ~/.perch/queries and adopts it as the
// only root. The directory is made whether or not it is adopted: it is the one destination the
// save dialog can always offer for an untitled query.
func EnsureDefaultWorkspace() (protocol.Settings, error) {
	dir := DefaultQueriesDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return DefaultSettings(), err
	}
	settings, err := GetSettings()
	if err != nil {
		return settings, err
	}
	if len(settings.Workspaces) > 0 {
		return settings, nil
	}
	return SaveSettings(func(s *protocol.Settings) { s.Workspaces = []string{dir} })
}
