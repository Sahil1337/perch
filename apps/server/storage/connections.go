package storage

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"perch/protocol"
)

// 0600: the one file perch writes that can hold a password.
var connectionsStore = NewStore(ConnectionsFile, 0o600, func() []protocol.ConnectionConfig {
	return []protocol.ConnectionConfig{}
})

func ListConnections() ([]protocol.ConnectionConfig, error) {
	return connectionsStore.Read()
}

func SaveConnections(list []protocol.ConnectionConfig) error {
	return connectionsStore.Write(list)
}

// GetConnection accepts either the id or the name, id first.
func GetConnection(idOrName string) (protocol.ConnectionConfig, bool, error) {
	list, err := ListConnections()
	if err != nil {
		return protocol.ConnectionConfig{}, false, err
	}
	for _, c := range list {
		if c.ID == idOrName {
			return c, true, nil
		}
	}
	for _, c := range list {
		if c.Name == idOrName {
			return c, true, nil
		}
	}
	return protocol.ConnectionConfig{}, false, nil
}

func UpsertConnection(record protocol.ConnectionConfig) (protocol.ConnectionConfig, error) {
	list, err := ListConnections()
	if err != nil {
		return record, err
	}
	for i, c := range list {
		if record.ID != "" && c.ID == record.ID {
			record.CreatedAt = c.CreatedAt
			list[i] = record
			return record, SaveConnections(list)
		}
	}
	if record.ID == "" {
		record.ID = NewID()
	}
	if record.CreatedAt == "" {
		record.CreatedAt = protocol.Now()
	}
	return record, SaveConnections(append(list, record))
}

func RemoveConnection(idOrName string) (bool, error) {
	list, err := ListConnections()
	if err != nil {
		return false, err
	}
	next := make([]protocol.ConnectionConfig, 0, len(list))
	for _, c := range list {
		if c.ID == idOrName || c.Name == idOrName {
			continue
		}
		next = append(next, c)
	}
	if len(next) == len(list) {
		return false, nil
	}
	return true, SaveConnections(next)
}

// NewID is a v4 UUID, matching the ids the TypeScript server wrote with randomUUID().
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString(b[:])
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
