package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const (
	DefaultPort  = 4600
	settingsFile = "launcher.json"
)

type Settings struct {
	LaunchOnOpen    bool      `json:"launchOnOpen"`
	Port            int       `json:"port"`
	CheckUpdates    bool      `json:"checkUpdates"`
	LastUpdateCheck time.Time `json:"lastUpdateCheck"`
}

func defaultSettings() Settings {
	return Settings{Port: DefaultPort, CheckUpdates: true}
}

// ConfigDir mirrors apps/server/storage.ConfigDir, copied rather than imported because nothing
// may depend on apps/server.
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

func validPort(p int) bool { return p >= 1024 && p <= 65535 }

// LoadSettings never fails the launcher: a missing or unreadable file means defaults, and fields
// absent from the file keep theirs.
func LoadSettings() Settings {
	s := defaultSettings()
	data, err := os.ReadFile(filepath.Join(ConfigDir(), settingsFile))
	if err != nil {
		return s
	}
	if json.Unmarshal(data, &s) != nil {
		return defaultSettings()
	}
	if !validPort(s.Port) {
		s.Port = DefaultPort
	}
	return s
}

func SaveSettings(s Settings) error {
	dir := ConfigDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, settingsFile+".*")
	if err != nil {
		return err
	}
	_, werr := tmp.Write(append(data, '\n'))
	if cerr := tmp.Close(); werr == nil {
		werr = cerr
	}
	if werr == nil {
		werr = os.Rename(tmp.Name(), filepath.Join(dir, settingsFile))
	}
	if werr != nil {
		_ = os.Remove(tmp.Name())
	}
	return werr
}
