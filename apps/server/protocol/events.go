package protocol

// The SSE frame's `event:` line carries Type and `data:` the whole event, so Type is both the
// discriminant and the frame name.
type ServerEvent interface{ EventType() string }

type HelloEvent struct {
	Type            string `json:"type"`
	ServerStartedAt string `json:"serverStartedAt"`
}

type FileServerEvent struct {
	Type  string    `json:"type"`
	Event FileEvent `json:"event"`
}

type RunServerEvent struct {
	Type   string    `json:"type"`
	RunID  string    `json:"runId"`
	Status RunStatus `json:"status"`
}

type RootsEvent struct {
	Type  string   `json:"type"`
	Roots []string `json:"roots"`
}

// TransactionEvent says a transaction held for a session key ended without a run ending it.
type TransactionEvent struct {
	Type         string            `json:"type"`
	ConnectionID string            `json:"connectionId"`
	SessionKey   string            `json:"sessionKey"`
	Database     string            `json:"database"`
	State        string            `json:"state"`
	Reason       TransactionReason `json:"reason"`
}

type TransactionReason string

const (
	ReasonIdle         TransactionReason = "idle"
	ReasonReleased     TransactionReason = "released"
	ReasonDisconnected TransactionReason = "disconnected"
	ReasonLost         TransactionReason = "lost"
)

func (e HelloEvent) EventType() string       { return e.Type }
func (e FileServerEvent) EventType() string  { return e.Type }
func (e RunServerEvent) EventType() string   { return e.Type }
func (e RootsEvent) EventType() string       { return e.Type }
func (e TransactionEvent) EventType() string { return e.Type }

func NewHello(serverStartedAt string) HelloEvent {
	return HelloEvent{Type: "hello", ServerStartedAt: serverStartedAt}
}

func NewFileServerEvent(event FileEvent) FileServerEvent {
	return FileServerEvent{Type: "file", Event: event}
}

func NewRunServerEvent(runID string, status RunStatus) RunServerEvent {
	return RunServerEvent{Type: "run", RunID: runID, Status: status}
}

func NewRootsEvent(roots []string) RootsEvent {
	if roots == nil {
		roots = make([]string, 0)
	}
	return RootsEvent{Type: "roots", Roots: roots}
}

func NewTransactionClosed(connectionID, database, sessionKey string, reason TransactionReason) TransactionEvent {
	return TransactionEvent{
		Type:         "transaction",
		ConnectionID: connectionID,
		SessionKey:   sessionKey,
		Database:     database,
		State:        "closed",
		Reason:       reason,
	}
}
