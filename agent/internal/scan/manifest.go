package scan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// DefaultPlatform is what a scan request without a platform means.
const DefaultPlatform = "linux/amd64"

// acceptManifests is every manifest media type the registry may answer with.
const acceptManifests = "application/vnd.oci.image.index.v1+json," +
	"application/vnd.docker.distribution.manifest.list.v2+json," +
	"application/vnd.oci.image.manifest.v1+json," +
	"application/vnd.docker.distribution.manifest.v2+json"

// maxManifestBytes caps a manifest read. Manifests are kilobytes; anything
// larger is not one.
const maxManifestBytes = 4 << 20

// unknownPlatform marks the attestation manifests buildx attaches to an index.
// They are not images and must never be picked as a fallback.
const unknownPlatform = "unknown"

// ErrManifestNotFound means the registry has no such repository or reference.
var ErrManifestNotFound = errors.New("manifest not found")

// ErrNoPlatform means the index has no manifest for the requested platform.
var ErrNoPlatform = errors.New("no manifest for platform")

type platform struct {
	Architecture string `json:"architecture"`
	OS           string `json:"os"`
	Variant      string `json:"variant"`
}

type descriptor struct {
	MediaType   string            `json:"mediaType"`
	Digest      string            `json:"digest"`
	Size        int64             `json:"size"`
	Platform    *platform         `json:"platform"`
	Annotations map[string]string `json:"annotations"`
}

type manifestEnvelope struct {
	MediaType string       `json:"mediaType"`
	Manifests []descriptor `json:"manifests"`
	Config    descriptor   `json:"config"`
}

// imageConfig is the part of an image's config blob that names its platform.
type imageConfig struct {
	Architecture string `json:"architecture"`
	OS           string `json:"os"`
	Variant      string `json:"variant"`
}

// resolved is one image manifest a scan can point Trivy at.
type resolved struct {
	digest   string
	platform string
}

// resolve finds the image manifest for repository:reference on the given
// platform, and reports the platform that manifest actually is.
//
// For an index it walks to the matching child. For a single image it reads the
// platform out of the image's own config blob rather than assuming the one
// that was asked for — a scan labelled linux/amd64 that actually scanned an
// arm64 image is worse than no scan. When the caller named a platform
// explicitly and the image is a different one, that is an error rather than a
// relabel; when the caller took the default, the image's own platform wins.
func (s *Scanner) resolve(ctx context.Context, repository, reference, wanted string, explicit bool) (resolved, error) {
	digest, envelope, err := s.fetchManifest(ctx, repository, reference)
	if err != nil {
		return resolved{}, err
	}

	isIndex := len(envelope.Manifests) > 0
	if !isIndex {
		return s.resolveImage(ctx, repository, reference, digest, envelope.Config, wanted, explicit)
	}

	child, exact, found := pickPlatform(envelope.Manifests, wanted)
	if !found {
		return resolved{}, fmt.Errorf("%w: %s:%s has no image manifest", ErrNoPlatform, repository, reference)
	}
	if explicit && !exact {
		return resolved{}, fmt.Errorf("%w: %s is not in the index for %s:%s",
			ErrNoPlatform, wanted, repository, reference)
	}
	return resolved{digest: child.Digest, platform: platformName(child.Platform)}, nil
}

// resolveImage labels a single-platform image with the platform its config
// declares.
func (s *Scanner) resolveImage(
	ctx context.Context,
	repository, reference, digest string,
	config descriptor,
	wanted string,
	explicit bool,
) (resolved, error) {
	actual, readErr := s.imagePlatform(ctx, repository, config.Digest)
	if readErr != nil {
		return resolved{}, readErr
	}
	if actual == "" {
		// Nothing in the config says what this is — an artifact rather than an
		// image. Refuse to put a platform on it that was never checked.
		if explicit {
			return resolved{}, fmt.Errorf("%w: %s:%s does not declare a platform",
				ErrNoPlatform, repository, reference)
		}
		return resolved{digest: digest, platform: wanted}, nil
	}
	if explicit && !platformsMatch(wanted, actual) {
		return resolved{}, fmt.Errorf("%w: %s:%s is %s, not %s",
			ErrNoPlatform, repository, reference, actual, wanted)
	}
	return resolved{digest: digest, platform: actual}, nil
}

// imagePlatform reads os, architecture and variant from an image's config
// blob. An empty result means the config names no platform.
func (s *Scanner) imagePlatform(ctx context.Context, repository, configDigest string) (string, error) {
	if configDigest == "" {
		return "", nil
	}

	url := s.internalBase + "/v2/" + repository + "/blobs/" + configDigest
	request, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if requestErr != nil {
		return "", fmt.Errorf("build config request: %w", requestErr)
	}

	response, doErr := s.client.Do(request)
	if doErr != nil {
		return "", fmt.Errorf("fetch image config: %w", doErr)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch image config: registry answered %d", response.StatusCode)
	}

	limited := io.LimitReader(response.Body, maxManifestBytes)
	body, readErr := io.ReadAll(limited)
	if readErr != nil {
		return "", fmt.Errorf("read image config: %w", readErr)
	}

	var config imageConfig
	unmarshalErr := json.Unmarshal(body, &config)
	if unmarshalErr != nil {
		return "", fmt.Errorf("parse image config: %w", unmarshalErr)
	}
	if config.OS == "" || config.Architecture == "" {
		return "", nil
	}
	return platformName(&platform{
		Architecture: config.Architecture,
		OS:           config.OS,
		Variant:      config.Variant,
	}), nil
}

// fetchManifest reads one manifest from the internal registry.
func (s *Scanner) fetchManifest(ctx context.Context, repository, reference string) (string, manifestEnvelope, error) {
	url := s.internalBase + "/v2/" + repository + "/manifests/" + reference
	request, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if requestErr != nil {
		return "", manifestEnvelope{}, fmt.Errorf("build manifest request: %w", requestErr)
	}
	request.Header.Set("Accept", acceptManifests)

	response, doErr := s.client.Do(request)
	if doErr != nil {
		return "", manifestEnvelope{}, fmt.Errorf("fetch manifest: %w", doErr)
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusNotFound {
		return "", manifestEnvelope{}, fmt.Errorf("%w: %s:%s", ErrManifestNotFound, repository, reference)
	}
	if response.StatusCode != http.StatusOK {
		return "", manifestEnvelope{}, fmt.Errorf("fetch manifest: registry answered %d", response.StatusCode)
	}

	limited := io.LimitReader(response.Body, maxManifestBytes)
	body, readErr := io.ReadAll(limited)
	if readErr != nil {
		return "", manifestEnvelope{}, fmt.Errorf("read manifest: %w", readErr)
	}

	var envelope manifestEnvelope
	unmarshalErr := json.Unmarshal(body, &envelope)
	if unmarshalErr != nil {
		return "", manifestEnvelope{}, fmt.Errorf("parse manifest: %w", unmarshalErr)
	}

	digest := response.Header.Get("Docker-Content-Digest")
	if digest == "" {
		return "", manifestEnvelope{}, errors.New("registry did not return a content digest")
	}
	return digest, envelope, nil
}

// pickPlatform chooses the child manifest for wanted. exact says the platform
// matched; found says an image was chosen at all. A caller that asked for a
// platform explicitly must refuse an inexact match.
func pickPlatform(manifests []descriptor, wanted string) (chosen descriptor, exact, found bool) {
	wantOS, wantArch, wantVariant := parsePlatform(wanted)

	for _, candidate := range manifests {
		if isAttestation(candidate) {
			continue
		}
		if candidate.Platform == nil {
			continue
		}
		if candidate.Platform.OS != wantOS || candidate.Platform.Architecture != wantArch {
			continue
		}
		if wantVariant != "" && candidate.Platform.Variant != wantVariant {
			continue
		}
		return candidate, true, true
	}

	for _, candidate := range manifests {
		if isAttestation(candidate) {
			continue
		}
		return candidate, false, true
	}
	return descriptor{}, false, false
}

// platformsMatch compares a requested platform with an actual one. A request
// that names no variant matches any variant; a request that names one does not.
func platformsMatch(wanted, actual string) bool {
	wantOS, wantArch, wantVariant := parsePlatform(wanted)
	actualOS, actualArch, actualVariant := parsePlatform(actual)

	if wantOS != actualOS || wantArch != actualArch {
		return false
	}
	if wantVariant == "" {
		return true
	}
	return wantVariant == actualVariant
}

// isAttestation reports whether a descriptor is one of buildx's provenance or
// SBOM manifests rather than an image.
func isAttestation(candidate descriptor) bool {
	if candidate.Platform != nil {
		if candidate.Platform.OS == unknownPlatform || candidate.Platform.Architecture == unknownPlatform {
			return true
		}
	}
	_, referenced := candidate.Annotations["vnd.docker.reference.type"]
	return referenced
}

func parsePlatform(value string) (osName, arch, variant string) {
	text := strings.TrimSpace(value)
	if text == "" {
		text = DefaultPlatform
	}
	parts := strings.Split(text, "/")
	switch len(parts) {
	case 1:
		return "linux", parts[0], ""
	case 2:
		return parts[0], parts[1], ""
	default:
		return parts[0], parts[1], parts[2]
	}
}

func platformName(p *platform) string {
	if p == nil {
		return DefaultPlatform
	}
	name := p.OS + "/" + p.Architecture
	if p.Variant != "" {
		name += "/" + p.Variant
	}
	return name
}
