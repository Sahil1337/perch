// Package storage owns everything perch keeps on disk. One directory holds all of it (default
// ~/.perch, override with PERCH_HOME): connections.json (0600), settings.json, history.jsonl,
// server.json, update.json, plus queries/, the workspace created on first run.
package storage

import (
	"os"
	"path/filepath"
)

const (
	ConnectionsFile = "connections.json"
	SettingsFile    = "settings.json"
	HistoryFile     = "history.jsonl"
	ServerInfoFile  = "server.json"
	UpdateCheckFile = "update.json"
	QueriesDirName  = "queries"
)

func ConfigDir() string {
	if dir := os.Getenv("PERCH_HOME"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".perch"
	}
	return filepath.Join(home, ".perch")
}

// DefaultQueriesDir is the workspace root created on first run, where .sql files live by default.
func DefaultQueriesDir() string {
	return filepath.Join(ConfigDir(), QueriesDirName)
}

func EnsureDir() (string, error) {
	dir := ConfigDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

func ConfigFile(name string) string {
	return filepath.Join(ConfigDir(), name)
}
