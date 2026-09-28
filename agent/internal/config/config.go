// Package config loads and validates the agent's configuration from the
// process environment. Nothing here reads the environment directly: Load takes
// a lookup function so the whole configuration surface stays testable.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// AuthMode selects how the public registry endpoint authenticates clients.
type AuthMode string

const (
	// AuthHtpasswd verifies Basic credentials against the agent's user store.
	AuthHtpasswd AuthMode = "htpasswd"
	// AuthNone lets anonymous clients pull and push. Only for a registry that
	// is not reachable from outside.
	AuthNone AuthMode = "none"
)

// MinAPIKeyLen is the shortest management key the agent accepts. A shorter key
// is a guessable key, and it also authenticates the service principal on the
// public endpoint.
const MinAPIKeyLen = 16

const (
	defaultListen             = ":5000"
	defaultAPIListen          = ":5080"
	defaultDataDir            = "/var/lib/registry-agent"
	defaultRegistryConfig     = "/etc/distribution/config.yml"
	defaultStorageRoot        = "/var/lib/registry"
	defaultInternalAddr       = "127.0.0.1:5001"
	defaultServiceUser        = "registry-vault"
	defaultGCRetryAfter       = 30
	defaultEventRetentionDays = 30
)

// defaultTrustedProxies is loopback only: without a proxy in front, the peer
// is the client and its X-Forwarded-* headers are its own claim.
var defaultTrustedProxies = [...]string{"127.0.0.0/8", "::1/128"}

// ErrMissingAPIKey is returned when AGENT_API_KEY is absent or too short.
var ErrMissingAPIKey = errors.New("AGENT_API_KEY is required and must be at least " +
	strconv.Itoa(MinAPIKeyLen) + " characters")

// Config is the agent's fully resolved configuration.
type Config struct {
	APIKey             string
	Listen             string
	APIListen          string
	DataDir            string
	RegistryConfig     string
	StorageRoot        string
	InternalAddr       string
	Auth               AuthMode
	HtpasswdImport     string
	ServiceUser        string
	ExtraCommand       string
	GCRetryAfter       int
	EventRetentionDays int
	TrivyEnabled       bool
	TrivyPath          string
	LogLevel           slog.Level

	// TrustedProxies are the peers whose X-Forwarded-For and
	// X-Forwarded-Proto headers the agent believes.
	TrustedProxies []netip.Prefix
}

// Lookup reads one environment variable. It has the shape of os.LookupEnv.
type Lookup func(key string) (string, bool)

// OSLookup reads the real process environment.
func OSLookup(key string) (string, bool) {
	return os.LookupEnv(key)
}

// Load resolves the configuration. It returns ErrMissingAPIKey when the
// management key is absent or too short; every other problem falls back to a
// documented default and is reported through warn.
func Load(env Lookup, warn func(msg string, args ...any)) (Config, error) {
	if env == nil {
		env = OSLookup
	}
	if warn == nil {
		warn = func(string, ...any) {}
	}

	apiKey := stringVar(env, "AGENT_API_KEY", "")
	if len(apiKey) < MinAPIKeyLen {
		return Config{}, ErrMissingAPIKey
	}

	auth, authErr := authMode(env)
	if authErr != nil {
		warn("invalid REGISTRY_AUTH, falling back to htpasswd", "error", authErr)
		auth = AuthHtpasswd
	}

	level, levelErr := logLevel(env)
	if levelErr != nil {
		warn("invalid AGENT_LOG_LEVEL, falling back to info", "error", levelErr)
		level = slog.LevelInfo
	}

	retryAfter, retryErr := intVar(env, "AGENT_GC_RETRY_AFTER", defaultGCRetryAfter, 1)
	if retryErr != nil {
		warn("invalid AGENT_GC_RETRY_AFTER, using default", "error", retryErr)
	}

	retentionDays, retentionErr := intVar(env, "AGENT_EVENT_RETENTION_DAYS", defaultEventRetentionDays, 1)
	if retentionErr != nil {
		warn("invalid AGENT_EVENT_RETENTION_DAYS, using default", "error", retentionErr)
	}

	trustedProxies, proxyErr := trustedProxies(env)
	if proxyErr != nil {
		warn("invalid AGENT_TRUSTED_PROXIES, trusting loopback only", "error", proxyErr)
		parsed, _ := parsePrefixes(defaultTrustedProxies[:])
		trustedProxies = parsed
	}

	registryConfig := stringVar(env, "REGISTRY_CONFIG", defaultRegistryConfig)
	storageRoot := resolveStorageRoot(env, registryConfig, warn)
	trivyPath, trivyEnabled := resolveTrivy(env, warn)

	cfg := Config{
		APIKey:             apiKey,
		Listen:             stringVar(env, "AGENT_LISTEN", defaultListen),
		APIListen:          stringVar(env, "AGENT_API_LISTEN", defaultAPIListen),
		DataDir:            stringVar(env, "AGENT_DATA_DIR", defaultDataDir),
		RegistryConfig:     registryConfig,
		StorageRoot:        storageRoot,
		InternalAddr:       stringVar(env, "REGISTRY_INTERNAL_ADDR", defaultInternalAddr),
		Auth:               auth,
		HtpasswdImport:     stringVar(env, "REGISTRY_HTPASSWD_IMPORT", ""),
		ServiceUser:        stringVar(env, "AGENT_SERVICE_USER", defaultServiceUser),
		ExtraCommand:       stringVar(env, "AGENT_EXTRA_COMMAND", ""),
		GCRetryAfter:       retryAfter,
		EventRetentionDays: retentionDays,
		TrivyEnabled:       trivyEnabled,
		TrivyPath:          trivyPath,
		LogLevel:           level,
		TrustedProxies:     trustedProxies,
	}
	return cfg, nil
}

// Features lists the management features this configuration exposes, in the
// order GET /api/v1/info reports them.
func (c Config) Features() []string {
	base := []string{"gc", "storage", "repositories", "uploads", "maintenance", "logs"}
	extra := make([]string, 0, 3)
	if c.Auth == AuthHtpasswd {
		extra = append(extra, "users")
	}
	extra = append(extra, "events")
	if c.TrivyEnabled {
		extra = append(extra, "scan")
	}

	features := make([]string, len(base)+len(extra))
	copy(features, base)
	copy(features[len(base):], extra)
	return features
}

func stringVar(env Lookup, key, fallback string) string {
	raw, ok := env(key)
	if !ok {
		return fallback
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func intVar(env Lookup, key string, fallback, minimum int) (int, error) {
	raw := stringVar(env, key, "")
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback, fmt.Errorf("%s: %w", key, err)
	}
	if value < minimum {
		return fallback, fmt.Errorf("%s: %d is below the minimum of %d", key, value, minimum)
	}
	return value, nil
}

// trustedProxies parses AGENT_TRUSTED_PROXIES. An empty value trusts nobody,
// which is the right answer for an agent exposed directly.
func trustedProxies(env Lookup) ([]netip.Prefix, error) {
	raw, set := env("AGENT_TRUSTED_PROXIES")
	trimmed := strings.TrimSpace(raw)
	if !set {
		return parsePrefixes(defaultTrustedProxies[:])
	}
	if trimmed == "" {
		return make([]netip.Prefix, 0), nil
	}
	parts := strings.Split(trimmed, ",")
	return parsePrefixes(parts)
}

// parsePrefixes accepts CIDR blocks and bare addresses, so a single proxy can
// be named without writing /32.
func parsePrefixes(values []string) ([]netip.Prefix, error) {
	out := make([]netip.Prefix, 0, len(values))
	for _, value := range values {
		text := strings.TrimSpace(value)
		if text == "" {
			continue
		}
		prefix, prefixErr := netip.ParsePrefix(text)
		if prefixErr == nil {
			out = append(out, prefix.Masked())
			continue
		}
		address, addressErr := netip.ParseAddr(text)
		if addressErr != nil {
			return nil, fmt.Errorf("AGENT_TRUSTED_PROXIES: %q is neither a CIDR block nor an address", text)
		}
		out = append(out, netip.PrefixFrom(address, address.BitLen()))
	}
	return out, nil
}

func authMode(env Lookup) (AuthMode, error) {
	raw := stringVar(env, "REGISTRY_AUTH", string(AuthHtpasswd))
	lowered := strings.ToLower(raw)
	switch AuthMode(lowered) {
	case AuthHtpasswd:
		return AuthHtpasswd, nil
	case AuthNone:
		return AuthNone, nil
	default:
		return AuthHtpasswd, fmt.Errorf("REGISTRY_AUTH: unknown mode %q", raw)
	}
}

func logLevel(env Lookup) (slog.Level, error) {
	raw := stringVar(env, "AGENT_LOG_LEVEL", "info")
	lowered := strings.ToLower(raw)
	switch lowered {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("AGENT_LOG_LEVEL: unknown level %q", raw)
	}
}

// resolveStorageRoot prefers the explicit override, then the registry config's
// filesystem root, then the documented default.
func resolveStorageRoot(env Lookup, registryConfig string, warn func(string, ...any)) string {
	override := stringVar(env, "REGISTRY_STORAGE_ROOT", "")
	if override != "" {
		return override
	}
	fromFile, err := StorageRootFromConfig(registryConfig)
	if err != nil {
		warn("could not read storage root from registry config", "path", registryConfig, "error", err)
		return defaultStorageRoot
	}
	if fromFile == "" {
		return defaultStorageRoot
	}
	return fromFile
}

// registryConfigFile is the sliver of the registry's config.yml the agent
// needs. Unknown keys are ignored by yaml.v3.
type registryConfigFile struct {
	Storage struct {
		Filesystem struct {
			RootDirectory string `yaml:"rootdirectory"`
		} `yaml:"filesystem"`
	} `yaml:"storage"`
}

// StorageRootFromConfig reads storage.filesystem.rootdirectory from a registry
// config file. An empty result means the file does not name one.
func StorageRootFromConfig(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read registry config: %w", err)
	}
	var parsed registryConfigFile
	unmarshalErr := yaml.Unmarshal(raw, &parsed)
	if unmarshalErr != nil {
		return "", fmt.Errorf("parse registry config: %w", unmarshalErr)
	}
	root := strings.TrimSpace(parsed.Storage.Filesystem.RootDirectory)
	return root, nil
}

// resolveTrivy decides whether scanning is on. The default follows the binary's
// presence; an explicit TRIVY_ENABLED=true without a binary is a warning and
// leaves scanning off, because an enabled feature that cannot run is worse than
// an absent one.
func resolveTrivy(env Lookup, warn func(string, ...any)) (string, bool) {
	path, lookErr := exec.LookPath("trivy")
	found := lookErr == nil

	raw := stringVar(env, "TRIVY_ENABLED", "")
	if raw == "" {
		return path, found
	}
	wanted, parseErr := strconv.ParseBool(raw)
	if parseErr != nil {
		warn("invalid TRIVY_ENABLED, using binary presence", "error", parseErr)
		return path, found
	}
	if !wanted {
		return "", false
	}
	if !found {
		warn("TRIVY_ENABLED is set but no trivy binary is on PATH; scanning stays off")
		return "", false
	}
	return path, true
}
