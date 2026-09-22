package protocol

type ConnectionConfig struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Dialect   Dialect        `json:"dialect"`
	Host      string         `json:"host"`
	Port      int            `json:"port"`
	User      string         `json:"user"`
	Password  string         `json:"password,omitempty"`
	Database  string         `json:"database"`
	SSL       bool           `json:"ssl,omitempty"`
	Options   map[string]any `json:"options,omitempty"`
	CreatedAt string         `json:"createdAt"`
}

type ConnectionStatus string

const (
	StatusConnected    ConnectionStatus = "connected"
	StatusDisconnected ConnectionStatus = "disconnected"
	StatusError        ConnectionStatus = "error"
)

// Spelled out rather than embedding ConnectionConfig, so Password cannot reach the wire.
type ConnectionSummary struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Dialect   Dialect          `json:"dialect"`
	Host      string           `json:"host"`
	Port      int              `json:"port"`
	User      string           `json:"user"`
	Database  string           `json:"database"`
	SSL       bool             `json:"ssl,omitempty"`
	Options   map[string]any   `json:"options,omitempty"`
	CreatedAt string           `json:"createdAt"`
	Status    ConnectionStatus `json:"status"`
	Error     string           `json:"error,omitempty"`
	Databases []string         `json:"databases,omitempty"`
}

func (c ConnectionConfig) Summary(status ConnectionStatus, errMsg string, databases []string) ConnectionSummary {
	return ConnectionSummary{
		ID:        c.ID,
		Name:      c.Name,
		Dialect:   c.Dialect,
		Host:      c.Host,
		Port:      c.Port,
		User:      c.User,
		Database:  c.Database,
		SSL:       c.SSL,
		Options:   c.Options,
		CreatedAt: c.CreatedAt,
		Status:    status,
		Error:     errMsg,
		Databases: databases,
	}
}

// Why a connection could not be opened, as the `code` on the error envelope. The UI branches on
// it: a server that asked for a password gets a password prompt rather than the whole form back,
// and a server that is not running gets told so instead of "authentication failed".
type ConnectFailureCode string

const (
	// The server asked for a password and the connection has none.
	ConnectPasswordRequired ConnectFailureCode = "password_required"
	// It has one and the server refused it.
	ConnectAuthFailed ConnectFailureCode = "auth_failed"
	// The login itself is unknown: no such role, or no pg_hba line that would let it in.
	ConnectUnknownUser     ConnectFailureCode = "unknown_user"
	ConnectUnknownDatabase ConnectFailureCode = "unknown_database"
	// Nothing answered at host:port.
	ConnectUnreachable ConnectFailureCode = "unreachable"
	ConnectTLSRequired ConnectFailureCode = "tls_required"
	// Anything else; the message is the driver's own.
	ConnectFailed ConnectFailureCode = "connect_failed"
)
