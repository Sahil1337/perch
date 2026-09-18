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
}
