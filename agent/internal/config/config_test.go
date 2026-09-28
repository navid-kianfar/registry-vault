package config

import (
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func lookupFrom(values map[string]string) Lookup {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}

func TestLoadRequiresALongEnoughAPIKey(t *testing.T) {
	cases := []struct {
		name   string
		values map[string]string
	}{
		{"missing", map[string]string{}},
		{"empty", map[string]string{"AGENT_API_KEY": ""}},
		{"too short", map[string]string{"AGENT_API_KEY": "123456789012345"}},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := Load(lookupFrom(testCase.values), nil)
			if !errors.Is(err, ErrMissingAPIKey) {
				t.Fatalf("error = %v, want ErrMissingAPIKey", err)
			}
		})
	}

	cfg, err := Load(lookupFrom(map[string]string{"AGENT_API_KEY": "1234567890123456"}), nil)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Listen != ":5000" || cfg.APIListen != ":5080" {
		t.Fatalf("defaults = %q, %q", cfg.Listen, cfg.APIListen)
	}
	if cfg.Auth != AuthHtpasswd {
		t.Fatalf("auth = %q, want htpasswd", cfg.Auth)
	}
	if cfg.GCRetryAfter != 30 || cfg.EventRetentionDays != 30 {
		t.Fatalf("defaults = %d, %d", cfg.GCRetryAfter, cfg.EventRetentionDays)
	}
}

func TestLoadFallsBackOnInvalidValues(t *testing.T) {
	warnings := 0
	warn := func(string, ...any) { warnings++ }

	cfg, err := Load(lookupFrom(map[string]string{
		"AGENT_API_KEY":              "a-management-key-long-enough",
		"REGISTRY_STORAGE_ROOT":      "/var/lib/registry",
		"REGISTRY_AUTH":              "oauth",
		"AGENT_LOG_LEVEL":            "chatty",
		"AGENT_GC_RETRY_AFTER":       "not-a-number",
		"AGENT_EVENT_RETENTION_DAYS": "0",
	}), warn)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Auth != AuthHtpasswd {
		t.Fatalf("auth = %q, want the htpasswd fallback", cfg.Auth)
	}
	if cfg.GCRetryAfter != 30 || cfg.EventRetentionDays != 30 {
		t.Fatalf("values = %d, %d; want the defaults", cfg.GCRetryAfter, cfg.EventRetentionDays)
	}
	if warnings != 4 {
		t.Fatalf("warnings = %d, want 4", warnings)
	}
}

func TestStorageRootPrecedence(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yml")
	content := "version: 0.1\nstorage:\n  delete:\n    enabled: true\n  filesystem:\n    rootdirectory: /data/registry\n"
	writeErr := os.WriteFile(configPath, []byte(content), 0o600)
	if writeErr != nil {
		t.Fatalf("write config: %v", writeErr)
	}

	fromFile, err := Load(lookupFrom(map[string]string{
		"AGENT_API_KEY":   "a-management-key-long-enough",
		"REGISTRY_CONFIG": configPath,
	}), nil)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if fromFile.StorageRoot != "/data/registry" {
		t.Fatalf("storage root = %q, want the config's value", fromFile.StorageRoot)
	}

	overridden, overrideErr := Load(lookupFrom(map[string]string{
		"AGENT_API_KEY":         "a-management-key-long-enough",
		"REGISTRY_CONFIG":       configPath,
		"REGISTRY_STORAGE_ROOT": "/mnt/other",
	}), nil)
	if overrideErr != nil {
		t.Fatalf("Load: %v", overrideErr)
	}
	if overridden.StorageRoot != "/mnt/other" {
		t.Fatalf("storage root = %q, want the override", overridden.StorageRoot)
	}

	missing, missingErr := Load(lookupFrom(map[string]string{
		"AGENT_API_KEY":   "a-management-key-long-enough",
		"REGISTRY_CONFIG": filepath.Join(dir, "absent.yml"),
	}), func(string, ...any) {})
	if missingErr != nil {
		t.Fatalf("Load: %v", missingErr)
	}
	if missing.StorageRoot != "/var/lib/registry" {
		t.Fatalf("storage root = %q, want the default", missing.StorageRoot)
	}
}

func TestTrustedProxies(t *testing.T) {
	const key = "a-management-key-long-enough"

	cases := []struct {
		name         string
		set          bool
		value        string
		trusts       []string
		doesNotTrust []string
		wantWarning  bool
	}{
		{
			name:         "loopback by default",
			set:          false,
			trusts:       []string{"127.0.0.1", "127.9.9.9", "::1"},
			doesNotTrust: []string{"10.0.0.1", "192.168.1.1", "203.0.113.9"},
		},
		{
			name:         "explicit CIDR blocks",
			set:          true,
			value:        "10.0.0.0/8, 192.168.1.0/24",
			trusts:       []string{"10.1.2.3", "192.168.1.7"},
			doesNotTrust: []string{"127.0.0.1", "192.168.2.7"},
		},
		{
			name:         "a bare address is a single host",
			set:          true,
			value:        "172.18.0.2",
			trusts:       []string{"172.18.0.2"},
			doesNotTrust: []string{"172.18.0.3"},
		},
		{
			name:         "empty trusts nobody",
			set:          true,
			value:        "",
			doesNotTrust: []string{"127.0.0.1", "::1", "10.0.0.1"},
		},
		{
			name:         "an unparsable value falls back to loopback",
			set:          true,
			value:        "10.0.0.0/8, not-an-address",
			trusts:       []string{"127.0.0.1"},
			doesNotTrust: []string{"10.1.2.3"},
			wantWarning:  true,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			values := map[string]string{"AGENT_API_KEY": key, "REGISTRY_STORAGE_ROOT": "/var/lib/registry"}
			if testCase.set {
				values["AGENT_TRUSTED_PROXIES"] = testCase.value
			}
			warnings := 0
			cfg, err := Load(lookupFrom(values), func(string, ...any) { warnings++ })
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if (warnings > 0) != testCase.wantWarning {
				t.Fatalf("warnings = %d, wantWarning = %v", warnings, testCase.wantWarning)
			}

			for _, address := range testCase.trusts {
				if !trusts(t, cfg, address) {
					t.Fatalf("%s should be trusted by %v", address, cfg.TrustedProxies)
				}
			}
			for _, address := range testCase.doesNotTrust {
				if trusts(t, cfg, address) {
					t.Fatalf("%s should not be trusted by %v", address, cfg.TrustedProxies)
				}
			}
		})
	}
}

func trusts(t *testing.T, cfg Config, address string) bool {
	t.Helper()

	parsed, err := netip.ParseAddr(address)
	if err != nil {
		t.Fatalf("parse %q: %v", address, err)
	}
	for _, prefix := range cfg.TrustedProxies {
		if prefix.Contains(parsed) {
			return true
		}
	}
	return false
}

func TestFeaturesFollowTheConfiguration(t *testing.T) {
	cases := []struct {
		name      string
		cfg       Config
		wantUsers bool
		wantScan  bool
	}{
		{"htpasswd with trivy", Config{Auth: AuthHtpasswd, TrivyEnabled: true}, true, true},
		{"htpasswd without trivy", Config{Auth: AuthHtpasswd}, true, false},
		{"anonymous with trivy", Config{Auth: AuthNone, TrivyEnabled: true}, false, true},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			features := testCase.cfg.Features()
			hasUsers := slices.Contains(features, "users")
			hasScan := slices.Contains(features, "scan")
			if hasUsers != testCase.wantUsers || hasScan != testCase.wantScan {
				t.Fatalf("features = %v", features)
			}
			if !slices.Contains(features, "events") || !slices.Contains(features, "gc") {
				t.Fatalf("features = %v, want gc and events always present", features)
			}
		})
	}
}
