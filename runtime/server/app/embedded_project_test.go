package app

import (
	"os"
	"path/filepath"
	"testing"

	"mindfs/server/internal/fs"
)

func TestEmbeddedRestoresStandaloneProjectIdentityAndHistory(t *testing.T) {
	for _, location := range []string{fs.MetaLocationProject, fs.MetaLocationHome} {
		t.Run(location, func(t *testing.T) {
			base := t.TempDir()
			t.Setenv("HOME", base)
			t.Setenv("USERPROFILE", base)
			hostDir, localDir := filepath.Join(base, "standalone"), filepath.Join(base, "embedded")
			t.Setenv("IDE_AGENT_REMOTE_HOST_DIR", hostDir)
			t.Setenv("IDE_AGENT_DATA_DIR", localDir)
			project := filepath.Join(base, "project")
			if err := os.Mkdir(project, 0700); err != nil {
				t.Fatal(err)
			}
			shared := fs.NewRegistry(filepath.Join(hostDir, "registry.json"))
			root, err := shared.UpsertWithMetaLocation(project, location)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := root.EnsureMetaDir(); err != nil {
				t.Fatal(err)
			}
			if err := root.WriteMetaFile("history.jsonl", []byte("existing conversation\n")); err != nil {
				t.Fatal(err)
			}
			local := fs.NewRegistry(filepath.Join(localDir, "registry.json"))
			for i := 0; i < 2; i++ {
				restored, err := registerEmbeddedProject(local, project)
				if err != nil {
					t.Fatal(err)
				}
				if restored.ID != root.ID || restored.MetaDir() != root.MetaDir() || len(local.List()) != 1 {
					t.Fatalf("identity changed: %+v", restored)
				}
				if data, err := os.ReadFile(filepath.Join(restored.MetaDir(), "history.jsonl")); err != nil || string(data) != "existing conversation\n" {
					t.Fatal("history changed", err)
				}
			}
			if location == fs.MetaLocationHome {
				if _, err := os.Stat(filepath.Join(project, ".mindfs")); !os.IsNotExist(err) {
					t.Fatal("home history must stay in its original location")
				}
			}
		})
	}
}
