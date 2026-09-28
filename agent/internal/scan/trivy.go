package scan

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"slices"
	"strings"
)

// trivyReport is the sliver of Trivy's JSON output the agent reads.
type trivyReport struct {
	Results []struct {
		Vulnerabilities []struct {
			VulnerabilityID  string `json:"VulnerabilityID"`
			PkgName          string `json:"PkgName"`
			InstalledVersion string `json:"InstalledVersion"`
			FixedVersion     string `json:"FixedVersion"`
			Severity         string `json:"Severity"`
			Title            string `json:"Title"`
			PrimaryURL       string `json:"PrimaryURL"`
		} `json:"Vulnerabilities"`
	} `json:"Results"`
}

// severityRank orders findings worst first.
var severityRank = map[string]int{
	"CRITICAL": 0,
	"HIGH":     1,
	"MEDIUM":   2,
	"LOW":      3,
	"UNKNOWN":  4,
}

// runTrivy scans one image from the internal registry. The registry speaks
// plain HTTP on loopback, so --insecure is required; nothing leaves the host
// except Trivy's database download.
func (s *Scanner) runTrivy(ctx context.Context, repository, digest string) ([]Vulnerability, error) {
	target := s.internalRegistryRef(repository, digest)

	runCtx, cancel := context.WithTimeout(ctx, scanTimeout)
	defer cancel()

	args := []string{
		"image",
		"--insecure",
		"--format", "json",
		"--quiet",
		"--cache-dir", s.cacheDir,
		target,
	}
	cmd := exec.CommandContext(runCtx, s.binary, args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	if runErr != nil {
		detail := lastLine(stderr.String())
		if detail == "" {
			return nil, fmt.Errorf("trivy: %w", runErr)
		}
		return nil, fmt.Errorf("trivy: %w: %s", runErr, detail)
	}

	var report trivyReport
	unmarshalErr := json.Unmarshal(stdout.Bytes(), &report)
	if unmarshalErr != nil {
		return nil, fmt.Errorf("parse trivy output: %w", unmarshalErr)
	}
	return flatten(report), nil
}

// internalRegistryRef is the pull reference Trivy uses. The digest already
// pins the platform, so Trivy needs no platform flag.
func (s *Scanner) internalRegistryRef(repository, digest string) string {
	host := strings.TrimPrefix(s.internalBase, "http://")
	return host + "/" + repository + "@" + digest
}

// flatten collects every result's vulnerabilities, deduplicates them and sorts
// them worst first.
func flatten(report trivyReport) []Vulnerability {
	seen := make(map[string]struct{})
	out := make([]Vulnerability, 0, 32)

	for _, result := range report.Results {
		for _, finding := range result.Vulnerabilities {
			key := finding.VulnerabilityID + "|" + finding.PkgName + "|" + finding.InstalledVersion
			_, already := seen[key]
			if already {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, Vulnerability{
				ID:               finding.VulnerabilityID,
				PkgName:          finding.PkgName,
				InstalledVersion: finding.InstalledVersion,
				FixedVersion:     finding.FixedVersion,
				Severity:         strings.ToUpper(finding.Severity),
				Title:            finding.Title,
				PrimaryURL:       finding.PrimaryURL,
			})
		}
	}

	slices.SortFunc(out, func(a, b Vulnerability) int {
		rankA, knownA := severityRank[a.Severity]
		if !knownA {
			rankA = len(severityRank)
		}
		rankB, knownB := severityRank[b.Severity]
		if !knownB {
			rankB = len(severityRank)
		}
		if rankA != rankB {
			return rankA - rankB
		}
		if a.PkgName != b.PkgName {
			return strings.Compare(a.PkgName, b.PkgName)
		}
		return strings.Compare(a.ID, b.ID)
	})
	return out
}

func summarise(findings []Vulnerability) Summary {
	summary := Summary{}
	for _, finding := range findings {
		switch finding.Severity {
		case "CRITICAL":
			summary.Critical++
		case "HIGH":
			summary.High++
		case "MEDIUM":
			summary.Medium++
		case "LOW":
			summary.Low++
		default:
			summary.Unknown++
		}
	}
	return summary
}

// lastLine is the most useful part of Trivy's stderr for an error message: the
// failure itself rather than its progress output.
func lastLine(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	lines := strings.Split(trimmed, "\n")
	last := strings.TrimSpace(lines[len(lines)-1])
	const maxDetail = 300
	if len(last) > maxDetail {
		return last[:maxDetail]
	}
	return last
}
