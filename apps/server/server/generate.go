package server

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"perch/httpx"
)

// Experimental: pipes a natural-language block through `claude -p` and answers with the SQL.
func (s *Server) registerGenerate() {
	s.handle("POST /api/generate", func(w http.ResponseWriter, r *http.Request) error {
		var body struct {
			Prompt  string `json:"prompt"`
			Dialect string `json:"dialect"`
			Schema  string `json:"schema"`
			File    string `json:"file"`
		}
		if err := httpx.DecodeJSON(r, &body); err != nil {
			return err
		}
		if strings.TrimSpace(body.Prompt) == "" {
			return httpx.BadRequest("empty prompt")
		}

		var b strings.Builder
		b.WriteString("You write a single " + body.Dialect + " SQL query for the request below.\n")
		b.WriteString("Reply with ONLY the SQL. No explanation, no markdown fences.\n")
		if strings.TrimSpace(body.Schema) != "" {
			b.WriteString("\nThe connected database's schema. Use only these tables and columns:\n<schema>\n" + body.Schema + "\n</schema>\n")
		}
		if strings.TrimSpace(body.File) != "" {
			b.WriteString("\nThe file the query goes into. Match how it is written (keyword case, aliasing, " +
				"formatting, naming), and reuse anything it already defines:\n<file>\n" + body.File + "\n</file>\n")
		}
		b.WriteString("\nRequest:\n" + body.Prompt + "\n")
		prompt := b.String()

		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, "claude", "-p", "--model", "sonnet", "--effort", "high")
		cmd.Stdin = strings.NewReader(prompt)
		cmd.Dir = os.TempDir()
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			return httpx.BadRequest("claude -p failed: " + err.Error() + " " + strings.TrimSpace(stderr.String()))
		}

		return httpx.JSON(w, map[string]string{"sql": stripFences(stdout.String())})
	})
}

func stripFences(out string) string {
	out = strings.TrimSpace(out)
	if strings.HasPrefix(out, "```") {
		if i := strings.Index(out, "\n"); i >= 0 {
			out = out[i+1:]
		}
		out = strings.TrimSuffix(strings.TrimSpace(out), "```")
	}
	return strings.TrimSpace(out)
}
