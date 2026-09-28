package gcjob

import "testing"

// The summary line is the collector's own count; the per-item lines are the
// fallback for when its wording changes.
func TestParseCountsPrefersTheSummaryLine(t *testing.T) {
	output := []string{
		"app: marking manifest sha256:aaaa",
		"blob eligible for deletion: sha256:bbbb",
		"blob eligible for deletion: sha256:cccc",
		"manifest eligible for deletion: sha256:dddd",
		"12 blobs marked, 7 blobs and 3 manifests eligible for deletion",
	}

	blobs, manifests := parseCounts(output)
	if blobs != 7 || manifests != 3 {
		t.Fatalf("counts = %d, %d; want 7, 3", blobs, manifests)
	}
}

func TestParseCountsFallsBackToCountingLines(t *testing.T) {
	output := []string{
		"blob eligible for deletion: sha256:bbbb",
		"blob eligible for deletion: sha256:cccc",
		"manifest eligible for deletion: sha256:dddd",
	}

	blobs, manifests := parseCounts(output)
	if blobs != 2 || manifests != 1 {
		t.Fatalf("counts = %d, %d; want 2, 1", blobs, manifests)
	}
}

func TestParseCountsOfAnEmptyRun(t *testing.T) {
	output := []string{"0 blobs marked, 0 blobs and 0 manifests eligible for deletion"}

	blobs, manifests := parseCounts(output)
	if blobs != 0 || manifests != 0 {
		t.Fatalf("counts = %d, %d; want 0, 0", blobs, manifests)
	}
}

func TestBlobDigestReadsBothWordings(t *testing.T) {
	const hex = "1111111111111111111111111111111111111111111111111111111111111111"
	cases := []struct {
		name string
		line string
		want string
		ok   bool
	}{
		{"digest form", "blob eligible for deletion: sha256:" + hex, "sha256:" + hex, true},
		{"path form", "blob eligible for deletion: /docker/registry/v2/blobs/sha256/11/" + hex + "/data", "sha256:" + hex, true},
		{"a manifest line is not a blob", "manifest eligible for deletion: sha256:" + hex, "", false},
		{"an unrelated line", "app: marking blob sha256:" + hex, "", false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got, ok := blobDigest(testCase.line)
			if ok != testCase.ok || got != testCase.want {
				t.Fatalf("= %q, %v; want %q, %v", got, ok, testCase.want, testCase.ok)
			}
		})
	}
}

func TestMajorVersion(t *testing.T) {
	cases := []struct {
		version string
		want    int
		wantErr bool
	}{
		{"3.0.0", 3, false},
		{"2.8.3", 2, false},
		{"3.0.0-rc.1", 3, false},
		{"not a version", 0, true},
	}

	for _, testCase := range cases {
		t.Run(testCase.version, func(t *testing.T) {
			got, err := majorVersion(testCase.version)
			if testCase.wantErr {
				if err == nil {
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("majorVersion: %v", err)
			}
			if got != testCase.want {
				t.Fatalf("major = %d, want %d", got, testCase.want)
			}
		})
	}
}

func TestTailKeepsTheMostRecentLines(t *testing.T) {
	lines := make([]string, 10)
	for index := range lines {
		lines[index] = string(rune('a' + index))
	}

	kept := tail(lines, 3)
	if len(kept) != 3 || kept[0] != "h" || kept[2] != "j" {
		t.Fatalf("tail = %v", kept)
	}

	all := tail(lines, 50)
	if len(all) != 10 {
		t.Fatalf("tail = %v, want every line", all)
	}
}
