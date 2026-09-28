package proxy

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// Distribution error codes the agent produces itself. Everything else comes
// from the registry, untouched.
const (
	codeUnauthorized = "UNAUTHORIZED"
	codeDenied       = "DENIED"
	codeUnavailable  = "UNAVAILABLE"
)

type registryError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type registryErrors struct {
	Errors []registryError `json:"errors"`
}

// writeRegistryError answers in the shape Docker clients expect, so the CLI
// shows the message instead of "unknown error".
func writeRegistryError(w http.ResponseWriter, status int, code, message string) {
	body := registryErrors{Errors: []registryError{{Code: code, Message: message}}}
	payload, marshalErr := json.Marshal(body)
	if marshalErr != nil {
		http.Error(w, message, status)
		return
	}
	header := w.Header()
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("Content-Length", strconv.Itoa(len(payload)))
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}
