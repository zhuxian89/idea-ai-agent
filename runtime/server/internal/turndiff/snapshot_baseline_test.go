package turndiff

import "testing"

func TestCaptureStoresOnlyDirtyAndUntrackedBytes(t *testing.T) {
	root := repo(t)
	write(t, root, "dirty.txt", "dirty\n")
	write(t, root, "untracked.txt", "untracked\n")
	snapshot := capture(t, root)
	if len(snapshot.files) != 2 {
		t.Fatalf("captured file bytes: %#v", snapshot.files)
	}
	if !snapshot.untracked["untracked.txt"] {
		t.Fatalf("untracked marker missing: %#v", snapshot.untracked)
	}
	if _, exists := snapshot.indexObjects["Main.java"]; !exists {
		t.Fatalf("clean tracked object missing: %#v", snapshot.indexObjects)
	}
}
