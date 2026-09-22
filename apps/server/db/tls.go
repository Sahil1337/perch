package db

import (
	"net"
	"strings"
	"time"

	"perch/protocol"
)

// A wrong hostname is the commonest mistake against a hosted database, and without this the
// driver waits on the OS instead of answering. Long enough for a cold serverless endpoint to
// wake up, short enough that the UI is not left spinning.
const connectTimeout = 10 * time.Second

// The modes pgx accepts. The value reaching this map came out of a URL query string and goes
// into a keyword DSN, where one carrying a space would inject further keywords; an unknown one
// only makes ParseConfig fail later. Either way the host-based default is the better answer.
var pgSSLModes = map[string]bool{
	"disable":     true,
	"allow":       true,
	"prefer":      true,
	"require":     true,
	"verify-ca":   true,
	"verify-full": true,
}

// sslModeFor picks what pgx negotiates. Four cases, in order:
//
//   - SSL off is off. The toggle is the user's last word, and an `sslmode` that the URL they
//     pasted earlier left in Options is not a reason to keep encrypting behind their back.
//   - A URL that named a mode pgx knows keeps it. A pasted hosted-Postgres string is the
//     connection's own documentation; perch is not better informed than the provider that
//     issued it.
//   - Over loopback, TLS is a local server's self-signed certificate, so `require` (encrypted,
//     unverified) is the only mode that works there.
//   - Anywhere else, `verify-full`. Neon, Supabase and RDS all present a publicly trusted
//     certificate, and an unverified tunnel to a host across the internet is not a tunnel.
//     A private CA is the case this gets wrong, and `?sslmode=require` is its answer.
func sslModeFor(config protocol.ConnectionConfig) string {
	if !config.SSL {
		return "disable"
	}
	if mode, ok := config.Options["sslmode"].(string); ok && mode != "" {
		if lower := strings.ToLower(mode); pgSSLModes[lower] {
			return lower
		}
	}
	if isLoopback(config.Host) {
		return "require"
	}
	return "verify-full"
}

// mysqlTLSFor is the same decision in go-sql-driver's vocabulary: "true" verifies the
// certificate against the system roots, "skip-verify" encrypts without checking it.
func mysqlTLSFor(config protocol.ConnectionConfig) string {
	if !config.SSL {
		return ""
	}
	if mode, ok := config.Options["sslmode"].(string); ok && mode != "" {
		switch strings.ToLower(mode) {
		case "disable":
			return ""
		case "verify-ca", "verify-full":
			return "true"
		case "require", "prefer", "allow":
			return "skip-verify"
		}
	}
	if isLoopback(config.Host) {
		return "skip-verify"
	}
	return "true"
}

func isLoopback(host string) bool {
	host = strings.Trim(host, "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// RemoteDefaultSSL is what a new connection starts with: a database reached over the network is
// assumed to want TLS, because every hosted provider requires it and a local one does not offer
// it. The user can still turn it off.
func RemoteDefaultSSL(host string) bool { return !isLoopback(host) }
