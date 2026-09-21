package protocol

type Theme string

const (
	ThemeDark  Theme = "dark"
	ThemeLight Theme = "light"
)

type KeywordCase string

const (
	KeywordPreserve KeywordCase = "preserve"
	KeywordUpper    KeywordCase = "upper"
	KeywordLower    KeywordCase = "lower"
)

// How much of a run survives it. `queries` is what perch has always kept — the shape of a run and
// its counts, never a row — and stays the default: turning on row storage without being asked
// would put a database's contents in a second place on disk that nobody chose.
type HistoryMode string

const (
	HistoryOff     HistoryMode = "off"
	HistoryQueries HistoryMode = "queries"
	HistoryResults HistoryMode = "results"
)

func (m HistoryMode) Valid() bool {
	return m == HistoryOff || m == HistoryQueries || m == HistoryResults
}

// KeepsRows is the one question the run path asks of the mode.
func (m HistoryMode) KeepsRows() bool { return m == HistoryResults }

// What the history store currently holds. `Bytes` is what perch has stored; `FileBytes` is what
// the file takes up, which is larger and does not shrink when runs are dropped — bbolt reuses the
// pages it frees rather than returning them, so the file plateaus instead of growing.
type HistoryStats struct {
	Runs      int   `json:"runs"`
	Bytes     int64 `json:"bytes"`
	FileBytes int64 `json:"fileBytes"`
}

type Settings struct {
	Autosave         bool        `json:"autosave"`
	AutosaveDelayMs  int         `json:"autosaveDelayMs"`
	MaxRows          int         `json:"maxRows"`
	StatementTimeout int         `json:"statementTimeoutMs"`
	Workspaces       []string    `json:"workspaces"`
	Theme            Theme       `json:"theme"`
	KeywordCase      KeywordCase `json:"keywordCase"`
	Onboarded        bool        `json:"onboarded"`
	// Folders that have been roots, newest first. Kept when a root is removed: closing a folder
	// should not mean losing the path.
	RecentWorkspaces []string `json:"recentWorkspaces"`
	// What a finished run leaves behind, and how much of it is kept.
	HistoryMode HistoryMode `json:"historyMode"`
	// The oldest run is dropped once either cap is passed. 0 means no cap.
	HistoryLimit int `json:"historyLimit"`
	HistoryMaxMB int `json:"historyMaxMb"`
}

// Every field is a pointer so absent stays distinct from set-to-zero: {"autosave": false} must
// turn autosave off, an omitted key must leave it alone.
type SettingsPatch struct {
	Autosave         *bool        `json:"autosave"`
	AutosaveDelayMs  *int         `json:"autosaveDelayMs"`
	MaxRows          *int         `json:"maxRows"`
	StatementTimeout *int         `json:"statementTimeoutMs"`
	Workspaces       *[]string    `json:"workspaces"`
	Theme            *Theme       `json:"theme"`
	KeywordCase      *KeywordCase `json:"keywordCase"`
	Onboarded        *bool        `json:"onboarded"`
	RecentWorkspaces *[]string    `json:"recentWorkspaces"`
	HistoryMode      *HistoryMode `json:"historyMode"`
	HistoryLimit     *int         `json:"historyLimit"`
	HistoryMaxMB     *int         `json:"historyMaxMb"`
}
