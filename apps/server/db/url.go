package db

import (
	"fmt"
	"net/url"
	"os/user"
	"strconv"
	"strings"

	"perch/protocol"
)

func DefaultPort(dialect protocol.Dialect) int {
	if dialect == protocol.DialectMySQL {
		return 3306
	}
	return 5432
}

var urlSchemes = map[string]protocol.Dialect{
	"postgres":   protocol.DialectPostgres,
	"postgresql": protocol.DialectPostgres,
	"pg":         protocol.DialectPostgres,
	"mysql":      protocol.DialectMySQL,
	"mariadb":    protocol.DialectMySQL,
}

// Query parameters that configure the connection rather than the driver options bag. `sslmode`
// is not among them: it sets the SSL flag *and* stays in Options, because "on" is not the whole
// answer — a pasted hosted-Postgres URL says which of the five modes it wants, and dropping that
// silently downgrades verify-full to an unverified tunnel.
var reservedParams = map[string]bool{"ssl": true, "dialect": true}

// NewDriver builds the driver for a connection's dialect.
func NewDriver(config protocol.ConnectionConfig) (Driver, error) {
	switch config.Dialect {
	case protocol.DialectPostgres:
		return newPostgresDriver(config), nil
	case protocol.DialectMySQL:
		return newMysqlDriver(config), nil
	}
	return nil, fmt.Errorf("unsupported dialect: %s", config.Dialect)
}

// ParseConnectionURL turns a postgres:// or mysql:// URL into a connection config. Missing
// pieces fall back to the OS user and `postgres` for PostgreSQL, `root` for MySQL;
// ?sslmode=require or ?ssl=true turns TLS on, and any other query parameter is kept in Options.
func ParseConnectionURL(raw string) (protocol.ConnectionConfig, error) {
	var config protocol.ConnectionConfig
	parsed, err := url.Parse(raw)
	if err != nil {
		return config, fmt.Errorf("invalid connection url: %s", raw)
	}
	dialect, ok := urlSchemes[strings.ToLower(parsed.Scheme)]
	if !ok {
		return config, fmt.Errorf(
			"unsupported connection url scheme %q — use postgres:// or mysql://", parsed.Scheme)
	}

	host := strings.Trim(parsed.Hostname(), "[]")
	if host == "" {
		host = "localhost"
	}
	port := DefaultPort(dialect)
	if raw := parsed.Port(); raw != "" {
		port, err = strconv.Atoi(raw)
		if err != nil || port <= 0 || port > 65535 {
			return config, fmt.Errorf("invalid port in connection url: %s", parsed.Port())
		}
	}

	user := ""
	password := ""
	if parsed.User != nil {
		user = parsed.User.Username()
		password, _ = parsed.User.Password()
	}
	if user == "" {
		if dialect == protocol.DialectMySQL {
			user = "root"
		} else {
			user = osUser()
		}
	}

	database := strings.TrimPrefix(parsed.Path, "/")
	if database == "" && dialect == protocol.DialectPostgres {
		database = "postgres"
	}

	query := parsed.Query()
	options := map[string]any{}
	for key, values := range query {
		if !reservedParams[strings.ToLower(key)] && len(values) > 0 {
			options[key] = values[0]
		}
	}

	config = protocol.ConnectionConfig{
		Dialect:  dialect,
		Host:     host,
		Port:     port,
		User:     user,
		Password: password,
		Database: database,
		SSL:      parseSSL(query),
	}
	if len(options) > 0 {
		config.Options = options
	}
	return config, nil
}

func parseSSL(query url.Values) bool {
	if mode := query.Get("sslmode"); mode != "" {
		switch strings.ToLower(mode) {
		case "disable", "allow":
			return false
		}
		return true
	}
	if !query.Has("ssl") {
		return false
	}
	switch strings.ToLower(query.Get("ssl")) {
	case "0", "false":
		return false
	}
	return true
}

func osUser() string {
	if current, err := user.Current(); err == nil && current.Username != "" {
		return current.Username
	}
	return "postgres"
}
