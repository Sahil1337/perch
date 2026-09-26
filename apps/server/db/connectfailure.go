package db

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"strings"

	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"

	"perch/protocol"
)

// A refused connection is the one failure a user is expected to fix, so it is the one failure
// worth reading. What the drivers hand back is not readable: pgx wraps the server's line in its
// own dial context and pins a SQLSTATE to the end of it, and MySQL answers a numbered error with
// the host it thinks you came from. Classify turns both into a code the UI can branch on and a
// sentence the user can act on.
//
// It lives here rather than in server/ because it reads driver error types, and db/ is the only
// layer allowed to import them.
type ConnectFailure struct {
	Code    protocol.ConnectFailureCode
	Message string
}

func (f ConnectFailure) Error() string { return f.Message }

// MySQL server error numbers worth telling apart. The rest are the driver's to describe.
const (
	myAccessDenied    = 1045
	myUnknownDatabase = 1049
	myDatabaseDenied  = 1044
	myHostNotAllowed  = 1130
)

// Postgres SQLSTATEs, likewise.
const (
	pgInvalidPassword = "28P01"
	pgInvalidAuth     = "28000"
	pgUnknownDatabase = "3D000"
)

// Classify reads a Connect or Test failure against the config it was made with. The config is
// what separates "this server wants a password" from "the password you gave it is wrong", which
// are the same error on the wire and different problems on screen.
func Classify(config protocol.ConnectionConfig, err error) ConnectFailure {
	if err == nil {
		return ConnectFailure{}
	}
	address := fmt.Sprintf("%s:%d", config.Host, config.Port)

	if failure, ok := classifyNetwork(err, address); ok {
		return failure
	}
	if failure, ok := classifyTLS(err); ok {
		return failure
	}
	if failure, ok := classifyPostgres(config, err); ok {
		return failure
	}
	if failure, ok := classifyMySQL(config, err); ok {
		return failure
	}
	return ConnectFailure{Code: protocol.ConnectFailed, Message: cleanMessage(err.Error())}
}

func classifyNetwork(err error, address string) (ConnectFailure, bool) {
	if errors.Is(err, context.DeadlineExceeded) {
		return ConnectFailure{
			Code:    protocol.ConnectUnreachable,
			Message: address + " did not answer in time.",
		}, true
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return ConnectFailure{
			Code:    protocol.ConnectUnreachable,
			Message: "No host named " + dns.Name + ".",
		}, true
	}
	var op *net.OpError
	if errors.As(err, &op) {
		if op.Timeout() {
			return ConnectFailure{
				Code:    protocol.ConnectUnreachable,
				Message: address + " did not answer in time.",
			}, true
		}
		return ConnectFailure{
			Code:    protocol.ConnectUnreachable,
			Message: "Nothing is listening on " + address + ". Is the server running?",
		}, true
	}
	return ConnectFailure{}, false
}

// TLS is verified by default against anything that is not loopback, so the certificate a private
// CA issued is a failure the user has to be told how to get past.
func classifyTLS(err error) (ConnectFailure, bool) {
	var unknownAuthority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	switch {
	case errors.As(err, &unknownAuthority), errors.As(err, &invalid):
		return ConnectFailure{
			Code: protocol.ConnectTLSRequired,
			Message: "The server's TLS certificate is not signed by a known authority. " +
				"Add ?sslmode=require to the connection URL to encrypt without verifying it.",
		}, true
	case errors.As(err, &hostname):
		return ConnectFailure{
			Code: protocol.ConnectTLSRequired,
			Message: "The server's TLS certificate is for a different host. " +
				"Add ?sslmode=require to the connection URL to encrypt without verifying it.",
		}, true
	}
	return ConnectFailure{}, false
}

func classifyPostgres(config protocol.ConnectionConfig, err error) (ConnectFailure, bool) {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		// The one Postgres failure that arrives as prose: a server built without TLS, or one
		// that has it off, answering a client that insisted on it.
		if strings.Contains(err.Error(), "server refused TLS") ||
			strings.Contains(err.Error(), "does not support SSL") {
			return ConnectFailure{
				Code:    protocol.ConnectTLSRequired,
				Message: "The server does not accept TLS. Turn SSL off for this connection.",
			}, true
		}
		return ConnectFailure{}, false
	}

	switch pgErr.Code {
	case pgInvalidPassword:
		return passwordFailure(config), true
	case pgInvalidAuth:
		// Two different problems share this SQLSTATE. "no pg_hba.conf entry" is the server saying
		// it will not take this login from this address at all, which no password fixes.
		if strings.Contains(pgErr.Message, "no pg_hba.conf entry") {
			message := "The server will not accept connections from here for " + quoted(config.User) + "."
			if strings.Contains(pgErr.Message, "no encryption") {
				message = "The server requires TLS for " + quoted(config.User) + ". Turn SSL on for this connection."
				return ConnectFailure{Code: protocol.ConnectTLSRequired, Message: message}, true
			}
			return ConnectFailure{Code: protocol.ConnectUnknownUser, Message: message}, true
		}
		return ConnectFailure{
			Code:    protocol.ConnectUnknownUser,
			Message: "The server has no user " + quoted(config.User) + ".",
		}, true
	case pgUnknownDatabase:
		return ConnectFailure{
			Code:    protocol.ConnectUnknownDatabase,
			Message: "The server has no database " + quoted(config.Database) + ".",
		}, true
	}
	return ConnectFailure{Code: protocol.ConnectFailed, Message: sentence(pgErr.Message)}, true
}

func classifyMySQL(config protocol.ConnectionConfig, err error) (ConnectFailure, bool) {
	var myErr *mysqldriver.MySQLError
	if !errors.As(err, &myErr) {
		return ConnectFailure{}, false
	}
	switch myErr.Number {
	case myAccessDenied:
		return passwordFailure(config), true
	case myHostNotAllowed:
		return ConnectFailure{
			Code:    protocol.ConnectUnknownUser,
			Message: "The server will not accept connections from here for " + quoted(config.User) + ".",
		}, true
	case myUnknownDatabase:
		return ConnectFailure{
			Code:    protocol.ConnectUnknownDatabase,
			Message: "The server has no database " + quoted(config.Database) + ".",
		}, true
	case myDatabaseDenied:
		return ConnectFailure{
			Code:    protocol.ConnectUnknownDatabase,
			Message: quoted(config.User) + " may not open the database " + quoted(config.Database) + ".",
		}, true
	}
	return ConnectFailure{Code: protocol.ConnectFailed, Message: sentence(myErr.Message)}, true
}

// The whole point of the classification: the same rejection means "type a password" when there is
// none stored and "that password is wrong" when there is.
func passwordFailure(config protocol.ConnectionConfig) ConnectFailure {
	if config.Password == "" {
		return ConnectFailure{
			Code:    protocol.ConnectPasswordRequired,
			Message: "The server wants a password for " + quoted(config.User) + ".",
		}
	}
	return ConnectFailure{
		Code:    protocol.ConnectAuthFailed,
		Message: "The server refused the password for " + quoted(config.User) + ".",
	}
}

func quoted(value string) string {
	if value == "" {
		return `""`
	}
	return `"` + value + `"`
}

// cleanMessage strips pgx's dial context, which repeats the address and the DSN the UI already
// shows, and drops the trailing SQLSTATE.
func cleanMessage(message string) string {
	if at := strings.LastIndex(message, "): "); at != -1 && strings.HasPrefix(message, "failed to connect to") {
		message = message[at+3:]
	}
	if at := strings.LastIndex(message, " (SQLSTATE "); at != -1 {
		message = message[:at]
	}
	// Whatever the driver said before the server's own line ("failed SASL auth:") describes the
	// protocol exchange, not the problem.
	if at := strings.LastIndex(message, "FATAL: "); at != -1 {
		message = message[at+len("FATAL: "):]
	}
	return sentence(message)
}

// Driver messages are lower-case fragments; the UI renders them as their own sentence.
func sentence(message string) string {
	message = strings.TrimSpace(strings.TrimPrefix(message, "FATAL: "))
	if message == "" {
		return "The connection failed."
	}
	if !strings.HasSuffix(message, ".") {
		message += "."
	}
	return strings.ToUpper(message[:1]) + message[1:]
}
