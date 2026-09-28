package scan

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const (
	imageDigest  = "sha256:1111111111111111111111111111111111111111111111111111111111111111"
	configDigest = "sha256:2222222222222222222222222222222222222222222222222222222222222222"
	amd64Digest  = "sha256:3333333333333333333333333333333333333333333333333333333333333333"
	arm64Digest  = "sha256:4444444444444444444444444444444444444444444444444444444444444444"
	attestDigest = "sha256:5555555555555555555555555555555555555555555555555555555555555555"
)

// fakeRegistry serves one manifest and one config blob, the way the child
// registry does.
type fakeRegistry struct {
	manifest any
	config   any
	server   *httptest.Server
}

func newFakeRegistry(t *testing.T, manifest, config any) *fakeRegistry {
	t.Helper()

	registry := &fakeRegistry{manifest: manifest, config: config}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/manifests/"):
			if registry.manifest == nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Docker-Content-Digest", imageDigest)
			w.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
			writeJSON(t, w, registry.manifest)
		case strings.Contains(r.URL.Path, "/blobs/"):
			if registry.config == nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			writeJSON(t, w, registry.config)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	registry.server = httptest.NewServer(handler)
	t.Cleanup(registry.server.Close)
	return registry
}

func writeJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()

	encoder := json.NewEncoder(w)
	encodeErr := encoder.Encode(value)
	if encodeErr != nil {
		t.Errorf("encode response: %v", encodeErr)
	}
}

func newTestScanner(t *testing.T, registry *fakeRegistry) *Scanner {
	t.Helper()

	parsed, parseErr := url.Parse(registry.server.URL)
	if parseErr != nil {
		t.Fatalf("parse url: %v", parseErr)
	}
	scanner, err := New(Options{
		Binary:       "trivy",
		DataDir:      t.TempDir(),
		InternalAddr: parsed.Host,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return scanner
}

// singleImage is a manifest for one platform, pointing at a config blob.
func singleImage() map[string]any {
	return map[string]any{
		"schemaVersion": 2,
		"mediaType":     "application/vnd.oci.image.manifest.v1+json",
		"config": map[string]any{
			"mediaType": "application/vnd.oci.image.config.v1+json",
			"digest":    configDigest,
			"size":      500,
		},
		"layers": []any{},
	}
}

func multiPlatformIndex() map[string]any {
	return map[string]any{
		"schemaVersion": 2,
		"mediaType":     "application/vnd.oci.image.index.v1+json",
		"manifests": []any{
			map[string]any{
				"digest":   amd64Digest,
				"platform": map[string]any{"os": "linux", "architecture": "amd64"},
			},
			map[string]any{
				"digest":   arm64Digest,
				"platform": map[string]any{"os": "linux", "architecture": "arm64"},
			},
			map[string]any{
				"digest":      attestDigest,
				"platform":    map[string]any{"os": "unknown", "architecture": "unknown"},
				"annotations": map[string]any{"vnd.docker.reference.type": "attestation-manifest"},
			},
		},
	}
}

func configFor(osName, arch, variant string) map[string]any {
	return map[string]any{"os": osName, "architecture": arch, "variant": variant}
}

// A single-platform image must be labelled with the platform it actually is,
// not the one the caller happened to ask for.
func TestResolveLabelsASingleImageFromItsConfig(t *testing.T) {
	registry := newFakeRegistry(t, singleImage(), configFor("linux", "arm64", ""))
	scanner := newTestScanner(t, registry)

	target, err := scanner.resolve(context.Background(), "app", "1.0.0", DefaultPlatform, false)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if target.platform != "linux/arm64" {
		t.Fatalf("platform = %q, want linux/arm64 — the image's own platform", target.platform)
	}
	if target.digest != imageDigest {
		t.Fatalf("digest = %q, want %q", target.digest, imageDigest)
	}
}

func TestResolveRefusesAnExplicitPlatformTheImageIsNot(t *testing.T) {
	registry := newFakeRegistry(t, singleImage(), configFor("linux", "arm64", ""))
	scanner := newTestScanner(t, registry)

	_, err := scanner.resolve(context.Background(), "app", "1.0.0", "linux/amd64", true)
	if !errors.Is(err, ErrNoPlatform) {
		t.Fatalf("error = %v, want ErrNoPlatform", err)
	}
	message := err.Error()
	if !strings.Contains(message, "linux/arm64") || !strings.Contains(message, "linux/amd64") {
		t.Fatalf("error = %q, want it to name both the image's platform and the requested one", message)
	}
}

func TestResolveAcceptsAnExplicitPlatformTheImageIs(t *testing.T) {
	registry := newFakeRegistry(t, singleImage(), configFor("linux", "arm64", "v8"))
	scanner := newTestScanner(t, registry)

	cases := []struct {
		name   string
		wanted string
	}{
		{"without a variant", "linux/arm64"},
		{"with the matching variant", "linux/arm64/v8"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			target, err := scanner.resolve(context.Background(), "app", "1.0.0", testCase.wanted, true)
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			if target.platform != "linux/arm64/v8" {
				t.Fatalf("platform = %q, want linux/arm64/v8", target.platform)
			}
		})
	}
}

func TestResolveRefusesAMismatchedVariant(t *testing.T) {
	registry := newFakeRegistry(t, singleImage(), configFor("linux", "arm", "v7"))
	scanner := newTestScanner(t, registry)

	_, err := scanner.resolve(context.Background(), "app", "1.0.0", "linux/arm/v6", true)
	if !errors.Is(err, ErrNoPlatform) {
		t.Fatalf("error = %v, want ErrNoPlatform", err)
	}
}

func TestResolveWalksAnIndexToTheRequestedPlatform(t *testing.T) {
	registry := newFakeRegistry(t, multiPlatformIndex(), nil)
	scanner := newTestScanner(t, registry)

	cases := []struct {
		name       string
		wanted     string
		explicit   bool
		wantDigest string
	}{
		{"the default platform", DefaultPlatform, false, amd64Digest},
		{"an explicit arm64", "linux/arm64", true, arm64Digest},
		{"an explicit amd64", "linux/amd64", true, amd64Digest},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			target, err := scanner.resolve(context.Background(), "app", "1.0.0", testCase.wanted, testCase.explicit)
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			if target.digest != testCase.wantDigest {
				t.Fatalf("digest = %q, want %q", target.digest, testCase.wantDigest)
			}
		})
	}
}

// Falling back to another architecture when one was asked for explicitly would
// report a scan of an image nobody asked about.
func TestResolveRefusesAPlatformMissingFromTheIndex(t *testing.T) {
	registry := newFakeRegistry(t, multiPlatformIndex(), nil)
	scanner := newTestScanner(t, registry)

	_, err := scanner.resolve(context.Background(), "app", "1.0.0", "linux/riscv64", true)
	if !errors.Is(err, ErrNoPlatform) {
		t.Fatalf("error = %v, want ErrNoPlatform", err)
	}

	// Without an explicit request, the first real image is a fair default.
	target, fallbackErr := scanner.resolve(context.Background(), "app", "1.0.0", "linux/riscv64", false)
	if fallbackErr != nil {
		t.Fatalf("resolve: %v", fallbackErr)
	}
	if target.digest != amd64Digest {
		t.Fatalf("digest = %q, want the first image in the index", target.digest)
	}
}

// buildx attaches provenance as manifests with an unknown platform. They are
// not images and must never be scanned.
func TestResolveNeverPicksAnAttestation(t *testing.T) {
	index := map[string]any{
		"schemaVersion": 2,
		"mediaType":     "application/vnd.oci.image.index.v1+json",
		"manifests": []any{
			map[string]any{
				"digest":      attestDigest,
				"platform":    map[string]any{"os": "unknown", "architecture": "unknown"},
				"annotations": map[string]any{"vnd.docker.reference.type": "attestation-manifest"},
			},
			map[string]any{
				"digest":   arm64Digest,
				"platform": map[string]any{"os": "linux", "architecture": "arm64"},
			},
		},
	}
	registry := newFakeRegistry(t, index, nil)
	scanner := newTestScanner(t, registry)

	target, err := scanner.resolve(context.Background(), "app", "1.0.0", "linux/riscv64", false)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if target.digest != arm64Digest {
		t.Fatalf("digest = %q, want the image rather than the attestation", target.digest)
	}
}

func TestResolveOnAnArtifactWithoutAPlatform(t *testing.T) {
	registry := newFakeRegistry(t, singleImage(), map[string]any{})
	scanner := newTestScanner(t, registry)

	_, err := scanner.resolve(context.Background(), "app", "1.0.0", "linux/amd64", true)
	if !errors.Is(err, ErrNoPlatform) {
		t.Fatalf("error = %v, want ErrNoPlatform for an explicit request", err)
	}

	target, defaultErr := scanner.resolve(context.Background(), "app", "1.0.0", DefaultPlatform, false)
	if defaultErr != nil {
		t.Fatalf("resolve: %v", defaultErr)
	}
	if target.platform != DefaultPlatform {
		t.Fatalf("platform = %q, want the requested default", target.platform)
	}
}

func TestResolveReportsAMissingManifest(t *testing.T) {
	registry := newFakeRegistry(t, nil, nil)
	scanner := newTestScanner(t, registry)

	_, err := scanner.resolve(context.Background(), "app", "nope", DefaultPlatform, false)
	if !errors.Is(err, ErrManifestNotFound) {
		t.Fatalf("error = %v, want ErrManifestNotFound", err)
	}
}

func TestSubmitRecordsWhetherThePlatformWasExplicit(t *testing.T) {
	registry := newFakeRegistry(t, singleImage(), configFor("linux", "amd64", ""))
	scanner := newTestScanner(t, registry)

	defaulted, err := scanner.Submit(Request{Repository: "app", Reference: "1.0.0"})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if defaulted.Platform != DefaultPlatform || defaulted.PlatformExplicit {
		t.Fatalf("defaulted = %+v, want the default platform and no explicit flag", defaulted)
	}

	asked, askedErr := scanner.Submit(Request{Repository: "app", Reference: "1.0.0", Platform: "linux/arm64"})
	if askedErr != nil {
		t.Fatalf("Submit: %v", askedErr)
	}
	if asked.Platform != "linux/arm64" || !asked.PlatformExplicit {
		t.Fatalf("asked = %+v, want linux/arm64 recorded as explicit", asked)
	}

	// The flag is internal: it must not reach the stored or served JSON.
	encoded, marshalErr := json.Marshal(asked)
	if marshalErr != nil {
		t.Fatalf("marshal: %v", marshalErr)
	}
	if strings.Contains(string(encoded), "PlatformExplicit") {
		t.Fatalf("serialised scan leaks an internal field: %s", encoded)
	}
}

func TestPlatformsMatch(t *testing.T) {
	cases := []struct {
		wanted string
		actual string
		want   bool
	}{
		{"linux/amd64", "linux/amd64", true},
		{"linux/amd64", "linux/arm64", false},
		{"linux/arm64", "linux/arm64/v8", true},
		{"linux/arm64/v8", "linux/arm64/v8", true},
		{"linux/arm64/v8", "linux/arm64", false},
		{"windows/amd64", "linux/amd64", false},
	}

	for _, testCase := range cases {
		t.Run(testCase.wanted+" vs "+testCase.actual, func(t *testing.T) {
			got := platformsMatch(testCase.wanted, testCase.actual)
			if got != testCase.want {
				t.Fatalf("platformsMatch(%q, %q) = %v, want %v",
					testCase.wanted, testCase.actual, got, testCase.want)
			}
		})
	}
}
