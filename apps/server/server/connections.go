package server

import (
	"net/http"

	"perch/db"
	"perch/httpx"
	"perch/protocol"
	"perch/storage"
)

type connectionBody struct {
	URL      *string        `json:"url"`
	Name     *string        `json:"name"`
	Dialect  *string        `json:"dialect"`
	Host     *string        `json:"host"`
	Port     *int           `json:"port"`
	User     *string        `json:"user"`
	Database *string        `json:"database"`
	Password *string        `json:"password"`
	SSL      *bool          `json:"ssl"`
	Options  map[string]any `json:"options"`
}

// connectionFromBody builds the stored config, merging over existing for a PUT. An explicit
// field always wins over one the url filled in.
func connectionFromBody(body connectionBody, existing *protocol.ConnectionConfig) (protocol.ConnectionConfig, error) {
	merged := protocol.ConnectionConfig{}
	if existing != nil {
		merged = *existing
	}
	if body.URL != nil && *body.URL != "" {
		// db/ returns plain errors; the API answers them in its own envelope.
		fromURL, err := db.ParseConnectionURL(*body.URL)
		if err != nil {
			return merged, httpx.BadRequest(err.Error())
		}
		fromURL.ID = merged.ID
		fromURL.Name = merged.Name
		fromURL.CreatedAt = merged.CreatedAt
		merged = fromURL
	}

	if body.Name != nil && *body.Name != "" {
		merged.Name = *body.Name
	}
	if merged.Name == "" {
		return merged, httpx.BadRequest("name is required")
	}

	if body.Dialect != nil {
		merged.Dialect = protocol.Dialect(*body.Dialect)
	}
	if merged.Dialect == "" {
		merged.Dialect = protocol.DialectPostgres
	}
	if merged.Dialect != protocol.DialectPostgres && merged.Dialect != protocol.DialectMySQL {
		return merged, httpx.BadRequest("unsupported dialect: " + string(merged.Dialect))
	}

	if body.Host != nil {
		merged.Host = *body.Host
	}
	if merged.Host == "" {
		merged.Host = "localhost"
	}
	if body.Port != nil {
		merged.Port = *body.Port
	}
	if merged.Port == 0 {
		merged.Port = db.DefaultPort(merged.Dialect)
	}
	if body.User != nil {
		merged.User = *body.User
	}
	if body.Database != nil {
		merged.Database = *body.Database
	}
	if merged.Database == "" && merged.Dialect == protocol.DialectPostgres {
		merged.Database = "postgres"
	}
	if body.Password != nil {
		merged.Password = *body.Password
	}
	if body.SSL != nil {
		merged.SSL = *body.SSL
	}
	if body.Options != nil {
		merged.Options = body.Options
	}
	return merged, nil
}

func (s *Server) registerConnections() {
	s.handle("GET /api/connections", func(w http.ResponseWriter, r *http.Request) error {
		summaries, err := s.pool.Summaries()
		if err != nil {
			return err
		}
		return httpx.JSON(w, summaries)
	})

	s.handle("POST /api/connections", func(w http.ResponseWriter, r *http.Request) error {
		var body connectionBody
		if err := httpx.DecodeJSON(r, &body); err != nil {
			return err
		}
		config, err := connectionFromBody(body, nil)
		if err != nil {
			return err
		}
		list, err := storage.ListConnections()
		if err != nil {
			return err
		}
		for _, existing := range list {
			if existing.Name == config.Name {
				return httpx.Conflict("a connection named "+config.Name+" already exists", nil)
			}
		}
		saved, err := storage.UpsertConnection(config)
		if err != nil {
			return err
		}
		return httpx.JSON(w, s.pool.Summary(saved), http.StatusCreated)
	})

	s.handle("PUT /api/connections/{id}", func(w http.ResponseWriter, r *http.Request) error {
		current, err := s.pool.Config(r.PathValue("id"))
		if err != nil {
			return err
		}
		var body connectionBody
		if err := httpx.DecodeJSON(r, &body); err != nil {
			return err
		}
		config, err := connectionFromBody(body, &current)
		if err != nil {
			return err
		}
		config.ID = current.ID
		saved, err := storage.UpsertConnection(config)
		if err != nil {
			return err
		}
		s.pool.Forget(current.ID)
		return httpx.JSON(w, s.pool.Summary(saved))
	})

	s.handle("DELETE /api/connections/{id}", func(w http.ResponseWriter, r *http.Request) error {
		current, err := s.pool.Config(r.PathValue("id"))
		if err != nil {
			return err
		}
		s.pool.Forget(current.ID)
		removed, err := storage.RemoveConnection(current.ID)
		if err != nil {
			return err
		}
		return httpx.JSON(w, map[string]any{"ok": removed})
	})

	s.handle("POST /api/connections/{id}/test", func(w http.ResponseWriter, r *http.Request) error {
		version, latency, err := s.pool.Test(r.Context(), r.PathValue("id"))
		if err != nil {
			return err
		}
		return httpx.JSON(w, map[string]any{"serverVersion": version, "latencyMs": latency})
	})

	s.handle("POST /api/connections/{id}/connect", func(w http.ResponseWriter, r *http.Request) error {
		summary, err := s.pool.Connect(r.Context(), r.PathValue("id"))
		if err != nil {
			return err
		}
		return httpx.JSON(w, summary)
	})

	s.handle("POST /api/connections/{id}/disconnect", func(w http.ResponseWriter, r *http.Request) error {
		summary, err := s.pool.Disconnect(r.PathValue("id"))
		if err != nil {
			return err
		}
		return httpx.JSON(w, summary)
	})

	s.handle("GET /api/connections/{id}/databases", func(w http.ResponseWriter, r *http.Request) error {
		databases, err := s.pool.Databases(r.Context(), r.PathValue("id"))
		if err != nil {
			return err
		}
		return httpx.JSON(w, databases)
	})
}

func (s *Server) registerSchema() {
	s.handle("GET /api/connections/{id}/schema", func(w http.ResponseWriter, r *http.Request) error {
		query := r.URL.Query()
		refresh := query.Get("refresh") == "1" || query.Get("refresh") == "true"
		schema, err := s.pool.Schema(r.Context(), r.PathValue("id"), query.Get("database"), refresh)
		if err != nil {
			return err
		}
		return httpx.JSON(w, schema)
	})
}

func (s *Server) registerDiscover() {
	s.handle("GET /api/discover", func(w http.ResponseWriter, r *http.Request) error {
		rescan := r.URL.Query().Get("rescan")
		return httpx.JSON(w, s.discovery.Result(r.Context(), rescan == "1" || rescan == "true"))
	})
}
