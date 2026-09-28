// Package proxy is the public registry endpoint: it authenticates, applies the
// write gate, streams the request to the child registry, and records pull,
// push and delete events.
package proxy

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/navid-kianfar/registry-vault/agent/internal/events"
	"github.com/navid-kianfar/registry-vault/agent/internal/gate"
	"github.com/navid-kianfar/registry-vault/agent/internal/users"
)

const (
	realm             = "Registry Vault"
	manifestsSegment  = "/manifests/"
	v2Prefix          = "/v2/"
	digestHeader      = "Docker-Content-Digest"
	forwardedProto    = "X-Forwarded-Proto"
	forwardedFor      = "X-Forwarded-For"
	dialTimeout       = 10 * time.Second
	idleConnTimeout   = 90 * time.Second
	maxIdleConns      = 128
	connectionBufSize = 64 * 1024
)

// Recorder is the sink for registry events. events.Log satisfies it; tests use
// their own.
type Recorder interface {
	Append(event events.Event) (events.Event, error)
}

// Options configures the public endpoint.
type Options struct {
	Target        *url.URL
	Authenticator *Authenticator
	Gate          *gate.Gate
	Events        Recorder
	RetryAfter    int
	Logger        *slog.Logger

	// TrustedProxies are the peers whose X-Forwarded-For and
	// X-Forwarded-Proto are believed. Empty means nobody is: the peer is the
	// client.
	TrustedProxies []netip.Prefix
}

// Handler is the public registry endpoint.
type Handler struct {
	target     *url.URL
	auth       *Authenticator
	gate       *gate.Gate
	events     Recorder
	retryAfter string
	logger     *slog.Logger
	trusted    []netip.Prefix
	proxy      *httputil.ReverseProxy
}

// New builds the public endpoint handler.
func New(opts Options) (*Handler, error) {
	if opts.Target == nil {
		return nil, fmt.Errorf("proxy: no target")
	}
	if opts.Authenticator == nil {
		return nil, fmt.Errorf("proxy: no authenticator")
	}
	if opts.Gate == nil {
		return nil, fmt.Errorf("proxy: no write gate")
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}

	h := &Handler{
		target:     opts.Target,
		auth:       opts.Authenticator,
		gate:       opts.Gate,
		events:     opts.Events,
		retryAfter: strconv.Itoa(opts.RetryAfter),
		logger:     logger,
		trusted:    slices.Clone(opts.TrustedProxies),
	}
	h.proxy = &httputil.ReverseProxy{
		Rewrite:        h.rewrite,
		ModifyResponse: h.rewriteLocation,
		ErrorHandler:   h.handleProxyError,
		Transport:      newTransport(),
	}
	return h, nil
}

// newTransport is tuned for a loopback registry: no compression (blobs are
// already compressed), no response-header timeout (a manifest PUT after a large
// upload can take a while), HTTP/1.1 so chunked uploads behave predictably.
func newTransport() *http.Transport {
	dialer := &net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}
	return &http.Transport{
		DialContext:           dialer.DialContext,
		MaxIdleConns:          maxIdleConns,
		MaxIdleConnsPerHost:   maxIdleConns,
		IdleConnTimeout:       idleConnTimeout,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    true,
		ForceAttemptHTTP2:     false,
		WriteBufferSize:       connectionBufSize,
		ReadBufferSize:        connectionBufSize,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	identity, authenticated := h.auth.Authenticate(r)
	if !authenticated {
		h.unauthorized(w, "authentication required")
		return
	}

	action := actionFor(r)
	allowed := identity.Role.Allows(action)
	if !allowed {
		h.denied(w, identity, action)
		return
	}

	if isMutating(action) {
		done, open, reason := h.gate.BeginWrite()
		if !open {
			h.unavailable(w, reason)
			return
		}
		defer done()
	}

	recorder := &responseRecorder{ResponseWriter: w}
	h.proxy.ServeHTTP(recorder, r)
	h.record(r, recorder, identity)
}

// rewrite keeps the client's Host so the registry's own URLs point back through
// the agent, and forwards the client's address and scheme.
//
// Inbound X-Forwarded-* headers are only believed when the peer is a
// configured proxy. From anyone else they are an unauthenticated claim, and
// SetXForwarded has already replaced them with what the agent can see for
// itself.
func (h *Handler) rewrite(pr *httputil.ProxyRequest) {
	inboundProto := pr.In.Header.Get(forwardedProto)
	inboundFor := pr.In.Header.Get(forwardedFor)
	fromTrustedProxy := h.trustsPeer(pr.In.RemoteAddr)

	pr.SetURL(h.target)
	pr.SetXForwarded()
	pr.Out.Host = pr.In.Host

	if !fromTrustedProxy {
		return
	}

	// A TLS terminator in front of the agent is the normal deployment, and its
	// X-Forwarded-Proto is the only way to know the public scheme. Only the two
	// valid values are accepted, so even a trusted proxy cannot inject an
	// arbitrary one.
	if inboundProto == "http" || inboundProto == "https" {
		pr.Out.Header.Set(forwardedProto, inboundProto)
	}
	// SetXForwarded trims the chain to the immediate peer; put the original
	// chain back in front of it so the registry and the event log see the
	// client rather than the terminator.
	if inboundFor != "" {
		peer := pr.Out.Header.Get(forwardedFor)
		pr.Out.Header.Set(forwardedFor, inboundFor+", "+peer)
	}
}

// trustsPeer reports whether the direct peer is one of the configured proxies.
func (h *Handler) trustsPeer(remoteAddr string) bool {
	if len(h.trusted) == 0 {
		return false
	}
	address, ok := peerAddress(remoteAddr)
	if !ok {
		return false
	}
	for _, prefix := range h.trusted {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

// peerAddress parses the address net/http reports for the connection.
func peerAddress(remoteAddr string) (netip.Addr, bool) {
	host, _, splitErr := net.SplitHostPort(remoteAddr)
	if splitErr != nil {
		host = remoteAddr
	}
	address, parseErr := netip.ParseAddr(host)
	if parseErr != nil {
		return netip.Addr{}, false
	}
	// An IPv4 address that arrived as ::ffff:a.b.c.d must compare against an
	// IPv4 prefix.
	if address.Is4In6() {
		address = address.Unmap()
	}
	return address, true
}

// rewriteLocation repoints an absolute Location header that names the internal
// registry at the public host, so an upload continues through the agent.
func (h *Handler) rewriteLocation(resp *http.Response) error {
	location := resp.Header.Get("Location")
	if location == "" {
		return nil
	}
	parsed, parseErr := url.Parse(location)
	if parseErr != nil || !parsed.IsAbs() {
		return nil
	}
	if parsed.Host != h.target.Host {
		return nil
	}

	outbound := resp.Request
	if outbound == nil || outbound.Host == "" {
		return nil
	}
	scheme := outbound.Header.Get(forwardedProto)
	if scheme != "http" && scheme != "https" {
		scheme = "http"
	}
	parsed.Scheme = scheme
	parsed.Host = outbound.Host
	resp.Header.Set("Location", parsed.String())
	return nil
}

func (h *Handler) handleProxyError(w http.ResponseWriter, r *http.Request, err error) {
	// The registry is a child process the agent owns; a failure to reach it is
	// operational, not something the client can fix, and its details stay in
	// the agent's log rather than in the response.
	h.logger.Error("proxy to registry failed", "method", r.Method, "path", r.URL.Path, "error", err)
	w.Header().Set("Retry-After", h.retryAfter)
	writeRegistryError(w, http.StatusBadGateway, codeUnavailable, "registry is unavailable")
}

func (h *Handler) unauthorized(w http.ResponseWriter, message string) {
	if h.auth.RequiresCredentials() {
		w.Header().Set("WWW-Authenticate", `Basic realm="`+realm+`"`)
	}
	writeRegistryError(w, http.StatusUnauthorized, codeUnauthorized, message)
}

func (h *Handler) denied(w http.ResponseWriter, identity Identity, action users.Action) {
	message := "insufficient scope for role " + string(identity.Role)
	if action == users.ActionCatalog {
		message = "the catalog requires the admin role"
	}
	if h.auth.RequiresCredentials() {
		w.Header().Set("WWW-Authenticate", `Basic realm="`+realm+`"`)
	}
	writeRegistryError(w, http.StatusUnauthorized, codeDenied, message)
}

func (h *Handler) unavailable(w http.ResponseWriter, reason string) {
	w.Header().Set("Retry-After", h.retryAfter)
	writeRegistryError(w, http.StatusServiceUnavailable, codeUnavailable, "registry is in maintenance: "+reason)
}

// record appends an event for a manifest operation that succeeded. It runs
// after the response has been written, so it never delays a client.
func (h *Handler) record(r *http.Request, recorder *responseRecorder, identity Identity) {
	if h.events == nil {
		return
	}
	eventType, interesting := EventTypeFor(r.Method, recorder.Status())
	if !interesting {
		return
	}
	repository, reference, matched := ParseManifestPath(r.URL.Path)
	if !matched {
		return
	}

	header := recorder.Header()
	event := events.Event{
		Type:       eventType,
		Repository: repository,
		Reference:  reference,
		Digest:     header.Get(digestHeader),
		Actor:      identity.Actor,
		RemoteAddr: h.clientAddr(r),
		UserAgent:  r.UserAgent(),
		At:         time.Now().UTC(),
	}
	_, appendErr := h.events.Append(event)
	if appendErr != nil {
		h.logger.Error("could not record event", "type", eventType, "repository", repository, "error", appendErr)
	}
}

// EventTypeFor maps a request method and its upstream status to an event type.
// HEAD is deliberately not a pull: clients probe with it.
func EventTypeFor(method string, status int) (events.Type, bool) {
	switch method {
	case http.MethodGet:
		if status == http.StatusOK {
			return events.TypePull, true
		}
	case http.MethodPut:
		if status == http.StatusCreated {
			return events.TypePush, true
		}
	case http.MethodDelete:
		if status == http.StatusAccepted {
			return events.TypeDelete, true
		}
	}
	return "", false
}

// ParseManifestPath splits /v2/<name>/manifests/<reference>. The repository
// name may contain slashes, and `manifests` is reserved, so the last occurrence
// of the segment is the separator.
func ParseManifestPath(path string) (repository, reference string, ok bool) {
	if !strings.HasPrefix(path, v2Prefix) {
		return "", "", false
	}
	index := strings.LastIndex(path, manifestsSegment)
	if index <= len(v2Prefix)-1 {
		return "", "", false
	}
	repository = path[len(v2Prefix):index]
	reference = path[index+len(manifestsSegment):]
	if repository == "" || reference == "" || strings.Contains(reference, "/") {
		return "", "", false
	}
	return repository, reference, true
}

// clientAddr is the address the event log records: the first entry of an
// inbound X-Forwarded-For when the peer is a trusted proxy, otherwise the peer
// address without its port. An untrusted client cannot put someone else's
// address in the accounting.
func (h *Handler) clientAddr(r *http.Request) string {
	if h.trustsPeer(r.RemoteAddr) {
		forwarded := r.Header.Get(forwardedFor)
		first, _, _ := strings.Cut(forwarded, ",")
		trimmed := strings.TrimSpace(first)
		if trimmed != "" {
			return trimmed
		}
	}
	host, _, splitErr := net.SplitHostPort(r.RemoteAddr)
	if splitErr != nil {
		return r.RemoteAddr
	}
	return host
}

// responseRecorder remembers the status the registry answered with, so the
// event rules can be applied after the body has streamed through untouched.
type responseRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (r *responseRecorder) WriteHeader(status int) {
	if !r.written {
		r.status = status
		r.written = true
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	if !r.written {
		r.status = http.StatusOK
		r.written = true
	}
	return r.ResponseWriter.Write(data)
}

// Status is the status sent upstream, defaulting to 200 as net/http does.
func (r *responseRecorder) Status() int {
	if !r.written {
		return http.StatusOK
	}
	return r.status
}

// Unwrap lets http.ResponseController reach the real writer, which is how
// httputil.ReverseProxy flushes streamed responses.
func (r *responseRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}
