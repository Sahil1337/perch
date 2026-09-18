// Package httpx is the HTTP plumbing shared by every route: the error envelope, JSON replies,
// and the two streaming framings.
package httpx

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

// Error carries the status and machine code a route answers with. Anything else reaching Wrap
// is a bug and answers 500.
type Error struct {
	Status  int
	Code    string
	Message string
	// Extra fields beside `error` in the envelope: the stale-write 409 sends the file as it is
	// on disk now, so the UI can diff without a second round trip.
	Details map[string]any
}

func (e *Error) Error() string { return e.Message }

func BadRequest(message string, code ...string) *Error {
	c := "bad_request"
	if len(code) > 0 {
		c = code[0]
	}
	return &Error{Status: http.StatusBadRequest, Code: c, Message: message}
}

func NotFound(message string) *Error {
	return &Error{Status: http.StatusNotFound, Code: "not_found", Message: message}
}

func Forbidden(message string) *Error {
	return &Error{Status: http.StatusForbidden, Code: "forbidden", Message: message}
}

func Conflict(message string, details map[string]any, code ...string) *Error {
	c := "conflict"
	if len(code) > 0 {
		c = code[0]
	}
	return &Error{Status: http.StatusConflict, Code: c, Message: message, Details: details}
}

type Handler func(http.ResponseWriter, *http.Request) error

// Wrap turns a returned error into the one envelope the whole API uses:
// {"error": {"message", "code"?}}.
func Wrap(h Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := h(w, r)
		if err == nil {
			return
		}
		var httpErr *Error
		if errors.As(err, &httpErr) {
			writeErrorEnvelope(w, httpErr.Status, httpErr.Message, httpErr.Code, httpErr.Details)
			return
		}
		log.Printf("[perch] %v", err)
		writeErrorEnvelope(w, http.StatusInternalServerError, err.Error(), "", nil)
	}
}

func WriteNotFound(w http.ResponseWriter, path string) {
	writeErrorEnvelope(w, http.StatusNotFound, "not found: "+path, "not_found", nil)
}

func writeErrorEnvelope(w http.ResponseWriter, status int, message, code string, details map[string]any) {
	body := make(map[string]any, len(details)+1)
	for k, v := range details {
		body[k] = v
	}
	envelope := map[string]any{"message": message}
	if code != "" {
		envelope["code"] = code
	}
	// Written last: a details bag adds fields beside the envelope, never replaces it.
	body["error"] = envelope

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// JSON writes a 200 (or the given status) with a JSON body.
func JSON(w http.ResponseWriter, value any, status ...int) error {
	code := http.StatusOK
	if len(status) > 0 {
		code = status[0]
	}
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_, err = w.Write(body)
	return err
}

// DecodeJSON reads a request body, answering 400 rather than 500 on malformed input.
func DecodeJSON(r *http.Request, target any) error {
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		return BadRequest("invalid JSON body")
	}
	return nil
}
