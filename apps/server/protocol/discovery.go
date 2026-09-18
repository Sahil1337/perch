package protocol

// Which probe found a server; several may agree on the same host:port.
type DiscoverySource string

const (
	SourcePort    DiscoverySource = "port"
	SourceBinary  DiscoverySource = "binary"
	SourceBrew    DiscoverySource = "brew"
	SourceSystemd DiscoverySource = "systemd"
	SourceWindows DiscoverySource = "windows"
	SourceDocker  DiscoverySource = "docker"
)

// perch never bundles a database; it looks for what is already installed or running.
type DiscoveredServer struct {
	Dialect   Dialect           `json:"dialect"`
	Host      string            `json:"host"`
	Port      int               `json:"port"`
	Sources   []DiscoverySource `json:"sources"`
	Version   string            `json:"version,omitempty"`
	Reachable bool              `json:"reachable"`
	// A starting point such as postgres://<os user>@localhost:5432/postgres. No password.
	SuggestedURL string `json:"suggestedUrl"`
	// Service name, container name or binary path.
	Label string `json:"label,omitempty"`
}

type DiscoveryResult struct {
	Servers    []DiscoveredServer `json:"servers"`
	OSUser     string             `json:"osUser"`
	ScannedAt  string             `json:"scannedAt"`
	DurationMs int64              `json:"durationMs"`
}
