package proxy

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/navid-kianfar/registry-vault/agent/internal/config"
	"github.com/navid-kianfar/registry-vault/agent/internal/events"
	"github.com/navid-kianfar/registry-vault/agent/internal/gate"
	"github.com/navid-kianfar/registry-vault/agent/internal/users"
)

const (
	testAPIKey      = "a-management-key-long-enough"
	testServiceUser = "registry-vault"
	testPassword    = "correct horse battery"
	testDigest      = "sha256:1111111111111111111111111111111111111111111111111111111111111111"
)

// recordingSink collects the events a handler produces.
type recordingSink struct {
	mu     sync.Mutex
	events []events.Event
}

func (r *recordingSink) Append(event events.Event) (events.Event, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	event.Seq = uint64(len(r.events) + 1)
	r.events = append(r.events, event)
	return event, nil
}

func (r *recordingSink) all() []events.Event {
	r.mu.Lock()
	defer r.mu.Unlock()

	out := make([]events.Event, len(r.events))
	copy(out, r.events)
	return out
}

// upstream answers like a registry: it echoes the status asked for in a query
// parameter and always sets a content digest.
func newUpstream(t *testing.T) *httptest.Server {
	t.Helper()

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Content-Digest", testDigest)
		status := http.StatusOK
		switch r.Method {
		case http.MethodPut:
			status = http.StatusCreated
		case http.MethodDelete:
			status = http.StatusAccepted
		}
		requested := r.URL.Query().Get("status")
		switch requested {
		case "404":
			status = http.StatusNotFound
		case "400":
			status = http.StatusBadRequest
		}
		w.WriteHeader(status)
		if r.Method != http.MethodHead {
			_, _ = w.Write([]byte(`{"ok":true}`))
		}
	})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}

type harness struct {
	handler *Handler
	sink    *recordingSink
	gate    *gate.Gate
	store   *users.Store
}

func newHarness(t *testing.T, mode config.AuthMode) *harness {
	t.Helper()

	upstream := newUpstream(t)
	target, parseErr := url.Parse(upstream.URL)
	if parseErr != nil {
		t.Fatalf("parse upstream url: %v", parseErr)
	}

	store, storeErr := users.New(t.TempDir(), testServiceUser)
	if storeErr != nil {
		t.Fatalf("users.New: %v", storeErr)
	}
	seedUsers(t, store)

	writeGate, gateErr := gate.New(t.TempDir())
	if gateErr != nil {
		t.Fatalf("gate.New: %v", gateErr)
	}

	sink := &recordingSink{}
	authenticator := NewAuthenticator(mode, testServiceUser, testAPIKey, store)
	handler, handlerErr := New(Options{
		Target:        target,
		Authenticator: authenticator,
		Gate:          writeGate,
		Events:        sink,
		RetryAfter:    30,
	})
	if handlerErr != nil {
		t.Fatalf("New: %v", handlerErr)
	}
	return &harness{handler: handler, sink: sink, gate: writeGate, store: store}
}

func seedUsers(t *testing.T, store *users.Store) {
	t.Helper()

	seeds := []struct {
		username string
		role     users.Role
	}{
		{"puller", users.RolePull},
		{"pusher", users.RolePush},
		{"boss", users.RoleAdmin},
	}
	for _, seed := range seeds {
		_, _, err := store.Create(seed.username, seed.role, testPassword)
		if err != nil {
			t.Fatalf("seed %s: %v", seed.username, err)
		}
	}
}

func (h *harness) do(t *testing.T, method, path, username, password string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(method, path, nil)
	if username != "" {
		request.SetBasicAuth(username, password)
	}
	recorder := httptest.NewRecorder()
	h.handler.ServeHTTP(recorder, request)
	return recorder
}

func TestAuthenticationIsRequired(t *testing.T) {
	h := newHarness(t, config.AuthHtpasswd)

	response := h.do(t, http.MethodGet, "/v2/", "", "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
	challenge := response.Header().Get("WWW-Authenticate")
	if !strings.Contains(challenge, `Basic realm="Registry Vault"`) {
		t.Fatalf("WWW-Authenticate = %q", challenge)
	}
	if !strings.Contains(response.Body.String(), `"UNAUTHORIZED"`) {
		t.Fatalf("body = %s", response.Body.String())
	}

	wrong := h.do(t, http.MethodGet, "/v2/", "puller", "wrong password")
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("status for a wrong password = %d, want 401", wrong.Code)
	}
}

func TestRolesGovernMethodsAndTheCatalog(t *testing.T) {
	h := newHarness(t, config.AuthHtpasswd)

	cases := []struct {
		name     string
		method   string
		path     string
		username string
		want     int
	}{
		{"login probe as pull", http.MethodGet, "/v2/", "puller", http.StatusOK},
		{"pull reads a manifest", http.MethodGet, "/v2/app/manifests/1.0.0", "puller", http.StatusOK},
		{"pull may not push", http.MethodPut, "/v2/app/manifests/1.0.0", "puller", http.StatusUnauthorized},
		{"pull may not start an upload", http.MethodPost, "/v2/app/blobs/uploads/", "puller", http.StatusUnauthorized},
		{"push may push", http.MethodPut, "/v2/app/manifests/1.0.0", "pusher", http.StatusCreated},
		{"push may patch an upload", http.MethodPatch, "/v2/app/blobs/uploads/abc", "pusher", http.StatusOK},
		{"push may not delete", http.MethodDelete, "/v2/app/manifests/" + testDigest, "pusher", http.StatusUnauthorized},
		{"admin may delete", http.MethodDelete, "/v2/app/manifests/" + testDigest, "boss", http.StatusAccepted},
		{"pull has no catalog", http.MethodGet, "/v2/_catalog", "puller", http.StatusUnauthorized},
		{"push has no catalog", http.MethodGet, "/v2/_catalog", "pusher", http.StatusUnauthorized},
		{"admin has the catalog", http.MethodGet, "/v2/_catalog", "boss", http.StatusOK},
		{"service principal has the catalog", http.MethodGet, "/v2/_catalog", testServiceUser, http.StatusOK},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			password := testPassword
			if testCase.username == testServiceUser {
				password = testAPIKey
			}
			response := h.do(t, testCase.method, testCase.path, testCase.username, password)
			if response.Code != testCase.want {
				t.Fatalf("status = %d, want %d (body %s)", response.Code, testCase.want, response.Body.String())
			}
		})
	}
}

func TestEventCaptureRules(t *testing.T) {
	cases := []struct {
		name      string
		method    string
		path      string
		username  string
		password  string
		wantEvent bool
		wantType  events.Type
		wantActor string
		wantRef   string
	}{
		{
			name: "a manifest GET is a pull", method: http.MethodGet,
			path: "/v2/app/manifests/1.0.0", username: "puller", password: testPassword,
			wantEvent: true, wantType: events.TypePull, wantActor: "puller", wantRef: "1.0.0",
		},
		{
			name: "a HEAD is not a pull", method: http.MethodHead,
			path: "/v2/app/manifests/1.0.0", username: "puller", password: testPassword,
		},
		{
			name: "a manifest PUT is a push", method: http.MethodPut,
			path: "/v2/app/manifests/1.0.0", username: "pusher", password: testPassword,
			wantEvent: true, wantType: events.TypePush, wantActor: "pusher", wantRef: "1.0.0",
		},
		{
			name: "a manifest DELETE is a delete", method: http.MethodDelete,
			path: "/v2/app/manifests/" + testDigest, username: "boss", password: testPassword,
			wantEvent: true, wantType: events.TypeDelete, wantActor: "boss", wantRef: testDigest,
		},
		{
			name: "the service principal is named", method: http.MethodGet,
			path: "/v2/app/manifests/1.0.0", username: testServiceUser, password: testAPIKey,
			wantEvent: true, wantType: events.TypePull, wantActor: testServiceUser, wantRef: "1.0.0",
		},
		{
			name: "a nested repository name keeps its slashes", method: http.MethodGet,
			path: "/v2/team/tool/manifests/2.0.0", username: "puller", password: testPassword,
			wantEvent: true, wantType: events.TypePull, wantActor: "puller", wantRef: "2.0.0",
		},
		{
			name: "a blob GET is not an event", method: http.MethodGet,
			path: "/v2/app/blobs/" + testDigest, username: "puller", password: testPassword,
		},
		{
			name: "a tag list is not an event", method: http.MethodGet,
			path: "/v2/app/tags/list", username: "puller", password: testPassword,
		},
		{
			name: "a failed pull is not an event", method: http.MethodGet,
			path: "/v2/app/manifests/1.0.0?status=404", username: "puller", password: testPassword,
		},
		{
			name: "a rejected push is not an event", method: http.MethodPut,
			path: "/v2/app/manifests/1.0.0?status=400", username: "pusher", password: testPassword,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t, config.AuthHtpasswd)
			h.do(t, testCase.method, testCase.path, testCase.username, testCase.password)

			recorded := h.sink.all()
			if !testCase.wantEvent {
				if len(recorded) != 0 {
					t.Fatalf("recorded %d events, want none: %+v", len(recorded), recorded)
				}
				return
			}
			if len(recorded) != 1 {
				t.Fatalf("recorded %d events, want 1", len(recorded))
			}
			event := recorded[0]
			if event.Type != testCase.wantType {
				t.Fatalf("type = %q, want %q", event.Type, testCase.wantType)
			}
			if event.Actor != testCase.wantActor {
				t.Fatalf("actor = %q, want %q", event.Actor, testCase.wantActor)
			}
			if event.Reference != testCase.wantRef {
				t.Fatalf("reference = %q, want %q", event.Reference, testCase.wantRef)
			}
			if event.Digest != testDigest {
				t.Fatalf("digest = %q, want %q", event.Digest, testDigest)
			}
			if event.At.IsZero() {
				t.Fatal("expected the event to be stamped")
			}
		})
	}
}

func TestParseManifestPath(t *testing.T) {
	cases := []struct {
		path           string
		wantRepository string
		wantReference  string
		wantOK         bool
	}{
		{"/v2/app/manifests/1.0.0", "app", "1.0.0", true},
		{"/v2/team/tool/manifests/2.0.0", "team/tool", "2.0.0", true},
		{"/v2/manifests/manifests/latest", "manifests", "latest", true},
		{"/v2/app/blobs/sha256:abc", "", "", false},
		{"/v2/app/manifests/", "", "", false},
		{"/v2/_catalog", "", "", false},
		{"/healthz", "", "", false},
	}

	for _, testCase := range cases {
		t.Run(testCase.path, func(t *testing.T) {
			repository, reference, ok := ParseManifestPath(testCase.path)
			if ok != testCase.wantOK {
				t.Fatalf("ok = %v, want %v", ok, testCase.wantOK)
			}
			if repository != testCase.wantRepository || reference != testCase.wantReference {
				t.Fatalf("= %q, %q; want %q, %q",
					repository, reference, testCase.wantRepository, testCase.wantReference)
			}
		})
	}
}

func TestWriteGateRejectsWritesButNeverReads(t *testing.T) {
	h := newHarness(t, config.AuthHtpasswd)
	release, _ := h.gate.Hold("garbage collection", 0)

	push := h.do(t, http.MethodPut, "/v2/app/manifests/1.0.0", "pusher", testPassword)
	if push.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", push.Code)
	}
	if push.Header().Get("Retry-After") != "30" {
		t.Fatalf("Retry-After = %q, want 30", push.Header().Get("Retry-After"))
	}
	body := push.Body.String()
	if !strings.Contains(body, `"UNAVAILABLE"`) ||
		!strings.Contains(body, "registry is in maintenance: garbage collection") {
		t.Fatalf("body = %s", body)
	}

	pull := h.do(t, http.MethodGet, "/v2/app/manifests/1.0.0", "puller", testPassword)
	if pull.Code != http.StatusOK {
		t.Fatalf("a read during a hold = %d, want 200", pull.Code)
	}

	release()
	after := h.do(t, http.MethodPut, "/v2/app/manifests/1.0.0", "pusher", testPassword)
	if after.Code != http.StatusCreated {
		t.Fatalf("status after the hold = %d, want 201", after.Code)
	}
}

// A rejected write must not be recorded: nothing was written.
func TestAGatedWriteIsNotAnEvent(t *testing.T) {
	h := newHarness(t, config.AuthHtpasswd)
	release, _ := h.gate.Hold("garbage collection", 0)
	defer release()

	h.do(t, http.MethodPut, "/v2/app/manifests/1.0.0", "pusher", testPassword)
	if len(h.sink.all()) != 0 {
		t.Fatalf("recorded %+v, want no events", h.sink.all())
	}
}

func TestAnonymousModeAllowsPullAndPushAndNamesTheActor(t *testing.T) {
	h := newHarness(t, config.AuthNone)

	pull := h.do(t, http.MethodGet, "/v2/app/manifests/1.0.0", "", "")
	if pull.Code != http.StatusOK {
		t.Fatalf("anonymous pull = %d, want 200", pull.Code)
	}
	recorded := h.sink.all()
	if len(recorded) != 1 || recorded[0].Actor != AnonymousActor {
		t.Fatalf("events = %+v, want one from %q", recorded, AnonymousActor)
	}

	push := h.do(t, http.MethodPut, "/v2/app/manifests/1.0.0", "", "")
	if push.Code != http.StatusCreated {
		t.Fatalf("anonymous push = %d, want 201", push.Code)
	}

	del := h.do(t, http.MethodDelete, "/v2/app/manifests/"+testDigest, "", "")
	if del.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous delete = %d, want 401", del.Code)
	}
	// A 401 in anonymous mode must not ask Docker to log in.
	if del.Header().Get("WWW-Authenticate") != "" {
		t.Fatal("did not expect a Basic challenge in anonymous mode")
	}

	service := h.do(t, http.MethodDelete, "/v2/app/manifests/"+testDigest, testServiceUser, testAPIKey)
	if service.Code != http.StatusAccepted {
		t.Fatalf("service principal delete = %d, want 202", service.Code)
	}
}

// forwardingHarness proxies to an upstream that reports back what it received.
type forwardingHarness struct {
	handler *Handler
	seen    chan *http.Request
	sink    *recordingSink
}

func newForwardingHarness(t *testing.T, trusted []netip.Prefix) *forwardingHarness {
	t.Helper()

	seen := make(chan *http.Request, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen <- r.Clone(r.Context())
		w.Header().Set("Docker-Content-Digest", testDigest)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(upstream.Close)

	target, parseErr := url.Parse(upstream.URL)
	if parseErr != nil {
		t.Fatalf("parse url: %v", parseErr)
	}
	writeGate, gateErr := gate.New(t.TempDir())
	if gateErr != nil {
		t.Fatalf("gate.New: %v", gateErr)
	}
	sink := &recordingSink{}
	handler, handlerErr := New(Options{
		Target:         target,
		Authenticator:  NewAuthenticator(config.AuthNone, testServiceUser, testAPIKey, nil),
		Gate:           writeGate,
		Events:         sink,
		RetryAfter:     30,
		TrustedProxies: trusted,
	})
	if handlerErr != nil {
		t.Fatalf("New: %v", handlerErr)
	}
	return &forwardingHarness{handler: handler, seen: seen, sink: sink}
}

func mustPrefixes(t *testing.T, values ...string) []netip.Prefix {
	t.Helper()

	out := make([]netip.Prefix, len(values))
	for index, value := range values {
		prefix, err := netip.ParsePrefix(value)
		if err != nil {
			t.Fatalf("parse prefix %q: %v", value, err)
		}
		out[index] = prefix
	}
	return out
}

func TestHostIsAlwaysPreserved(t *testing.T) {
	h := newForwardingHarness(t, nil)

	request := httptest.NewRequest(http.MethodGet, "/v2/", nil)
	request.Host = "registry.example.com"
	h.handler.ServeHTTP(httptest.NewRecorder(), request)

	forwarded := <-h.seen
	if forwarded.Host != "registry.example.com" {
		t.Fatalf("Host = %q, want the client's host", forwarded.Host)
	}
	if forwarded.Header.Get("X-Forwarded-For") == "" {
		t.Fatal("expected X-Forwarded-For to be set from the peer")
	}
}

// A TLS terminator's X-Forwarded-Proto is the only way to know the public
// scheme, so it is honoured — but only when the terminator is the peer. From
// anyone else it is an unauthenticated claim that would make the registry hand
// out https upload URLs for a plain-http deployment, or hide a client's real
// address from the accounting.
func TestForwardedHeadersAreOnlyBelievedFromATrustedProxy(t *testing.T) {
	const peer = "203.0.113.9:4321"

	cases := []struct {
		name      string
		trusted   []netip.Prefix
		wantProto string
		wantFor   string
		wantActor string
	}{
		{
			name:      "an untrusted peer speaks only for itself",
			trusted:   nil,
			wantProto: "http",
			wantFor:   "203.0.113.9",
			wantActor: "203.0.113.9",
		},
		{
			name:      "loopback only does not cover a public peer",
			trusted:   mustPrefixes(t, "127.0.0.0/8", "::1/128"),
			wantProto: "http",
			wantFor:   "203.0.113.9",
			wantActor: "203.0.113.9",
		},
		{
			name:      "a configured proxy is believed",
			trusted:   mustPrefixes(t, "203.0.113.0/24"),
			wantProto: "https",
			wantFor:   "198.51.100.7, 203.0.113.9",
			wantActor: "198.51.100.7",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newForwardingHarness(t, testCase.trusted)

			request := httptest.NewRequest(http.MethodGet, "/v2/app/manifests/1.0.0", nil)
			request.Host = "registry.example.com"
			request.RemoteAddr = peer
			request.Header.Set("X-Forwarded-Proto", "https")
			request.Header.Set("X-Forwarded-For", "198.51.100.7")
			h.handler.ServeHTTP(httptest.NewRecorder(), request)

			forwarded := <-h.seen
			if forwarded.Header.Get("X-Forwarded-Proto") != testCase.wantProto {
				t.Fatalf("X-Forwarded-Proto = %q, want %q",
					forwarded.Header.Get("X-Forwarded-Proto"), testCase.wantProto)
			}
			if forwarded.Header.Get("X-Forwarded-For") != testCase.wantFor {
				t.Fatalf("X-Forwarded-For = %q, want %q",
					forwarded.Header.Get("X-Forwarded-For"), testCase.wantFor)
			}

			recorded := h.sink.all()
			if len(recorded) != 1 {
				t.Fatalf("recorded %d events, want 1", len(recorded))
			}
			if recorded[0].RemoteAddr != testCase.wantActor {
				t.Fatalf("event remoteAddr = %q, want %q", recorded[0].RemoteAddr, testCase.wantActor)
			}
		})
	}
}

func TestTrustsPeerHandlesAddressForms(t *testing.T) {
	h := newForwardingHarness(t, mustPrefixes(t, "127.0.0.0/8", "::1/128"))

	cases := []struct {
		remoteAddr string
		want       bool
	}{
		{"127.0.0.1:5000", true},
		{"127.9.9.9:5000", true},
		{"[::1]:5000", true},
		{"[::ffff:127.0.0.1]:5000", true},
		{"192.168.1.4:5000", false},
		{"not-an-address", false},
		{"", false},
	}

	for _, testCase := range cases {
		t.Run(testCase.remoteAddr, func(t *testing.T) {
			got := h.handler.trustsPeer(testCase.remoteAddr)
			if got != testCase.want {
				t.Fatalf("trustsPeer(%q) = %v, want %v", testCase.remoteAddr, got, testCase.want)
			}
		})
	}
}

func TestLocationHeaderIsRepointedAtThePublicHost(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A registry that knows its own address answers with an absolute URL.
		w.Header().Set("Location", "http://"+r.Host+"/v2/app/blobs/uploads/abc?_state=xyz")
		w.WriteHeader(http.StatusAccepted)
	}))
	defer upstream.Close()

	target, parseErr := url.Parse(upstream.URL)
	if parseErr != nil {
		t.Fatalf("parse url: %v", parseErr)
	}

	// The upstream echoes the Host it receives, which the agent preserves, so
	// point the proxy at the internal address explicitly.
	internal, internalErr := url.Parse(upstream.URL)
	if internalErr != nil {
		t.Fatalf("parse url: %v", internalErr)
	}
	writeGate, gateErr := gate.New(t.TempDir())
	if gateErr != nil {
		t.Fatalf("gate.New: %v", gateErr)
	}
	handler, handlerErr := New(Options{
		Target:        target,
		Authenticator: NewAuthenticator(config.AuthNone, testServiceUser, testAPIKey, nil),
		Gate:          writeGate,
		RetryAfter:    30,
	})
	if handlerErr != nil {
		t.Fatalf("New: %v", handlerErr)
	}

	request := httptest.NewRequest(http.MethodPost, "/v2/app/blobs/uploads/", nil)
	request.Host = internal.Host
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	location := recorder.Header().Get("Location")
	if !strings.HasPrefix(location, "http://"+internal.Host+"/v2/app/blobs/uploads/abc") {
		t.Fatalf("Location = %q", location)
	}
}
