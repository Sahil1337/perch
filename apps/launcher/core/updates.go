package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const updateInterval = 24 * time.Hour

type UpdateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
}

func (p Perch) CheckUpdate() (UpdateInfo, error) {
	var info UpdateInfo
	out, err := p.run(time.Minute, "update", "--check", "--json")
	if err != nil {
		return info, err
	}
	// Tolerate a notice printed before the object.
	start := bytes.IndexByte(out, '{')
	if start < 0 {
		return info, errors.New("perch update --check --json printed no JSON")
	}
	err = json.Unmarshal(out[start:], &info)
	return info, err
}

// Update runs `perch update` as its own process, so the download and checksum work never lands
// in the launcher's memory.
func (p Perch) Update() error {
	_, err := p.run(10*time.Minute, "update")
	return err
}

func updateDue(s Settings, now time.Time) bool {
	return s.CheckUpdates && now.Sub(s.LastUpdateCheck) >= updateInterval
}

func displayVersion(v string) string {
	if v == "" || strings.HasPrefix(v, "v") {
		return v
	}
	return "v" + v
}
