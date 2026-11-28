package turndiff

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadArtifactRejectsTraversalBlob(t *testing.T) {
	parent := t.TempDir()
	session := "session"
	file := ChangedFile{
		Path:   "file.txt",
		Before: FileState{Present: true, Mode: 0o644, Bytes: []byte("before")},
		After:  FileState{Present: true, Mode: 0o644, Bytes: []byte("after")},
	}
	id, err := SaveArtifact(parent, session, []ChangedFile{file})
	if err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(parent, "turn-diffs", id, "manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest artifactManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	malicious := "../../../" + strings.Repeat("a", 55) + "-644"
	manifest.Files[0].Before.Blob = malicious
	manifest.Files[0].Before.Size = 0
	data, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadArtifact(parent, session, id, "file.txt"); err == nil {
		t.Fatal("traversal blob was accepted")
	}
}

func TestDeleteSessionArtifactsDeletesMatchingOnly(t *testing.T) {
	parent := t.TempDir()
	file := ChangedFile{
		Path:   "file.txt",
		Before: FileState{Present: true, Mode: 0o644, Bytes: []byte("before")},
		After:  FileState{Present: true, Mode: 0o644, Bytes: []byte("after")},
	}
	idA1, err := SaveArtifact(parent, "sess-a", []ChangedFile{file})
	if err != nil {
		t.Fatal(err)
	}
	idA2, err := SaveArtifact(parent, "sess-a-child", []ChangedFile{file})
	if err != nil {
		t.Fatal(err)
	}
	idB, err := SaveArtifact(parent, "sess-b", []ChangedFile{file})
	if err != nil {
		t.Fatal(err)
	}

	if err := DeleteSessionArtifacts(parent, []string{"sess-a", "sess-a-child"}); err != nil {
		t.Fatalf("DeleteSessionArtifacts: %v", err)
	}
	for _, removedID := range []string{idA1, idA2} {
		if _, err := os.Stat(filepath.Join(parent, "turn-diffs", removedID)); !os.IsNotExist(err) {
			t.Fatalf("expected snapshot %s deleted, stat err=%v", removedID, err)
		}
	}
	if _, err := LoadArtifact(parent, "sess-b", idB, "file.txt"); err != nil {
		t.Fatalf("unrelated session snapshot should remain intact: %v", err)
	}
}
