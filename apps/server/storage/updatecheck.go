package storage

// update.json remembers the last release perch saw, so the look `perch serve` takes for a newer
// version costs one request a day rather than one per start.
type UpdateCheck struct {
	CheckedAt string `json:"checkedAt"`
	Latest    string `json:"latest"`
}

var updateCheckStore = NewStore(UpdateCheckFile, 0o600, func() *UpdateCheck { return nil })

func ReadUpdateCheck() (*UpdateCheck, error) { return updateCheckStore.Read() }

func WriteUpdateCheck(check UpdateCheck) error { return updateCheckStore.Write(&check) }
