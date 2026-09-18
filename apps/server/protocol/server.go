package protocol

type ServerInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	PID       int    `json:"pid"`
	URL       string `json:"url"`
	StartedAt string `json:"startedAt"`
	ConfigDir string `json:"configDir"`
	// <ConfigDir>/queries. Sent rather than joined client-side: the separator is the server's.
	QueriesDir string `json:"queriesDir"`
}

type BrowseEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type BrowseResult struct {
	Path string `json:"path"`
	// Nil at the top of the filesystem.
	Parent  *string       `json:"parent"`
	Home    string        `json:"home"`
	Entries []BrowseEntry `json:"entries"`
}
