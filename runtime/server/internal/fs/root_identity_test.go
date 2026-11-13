package fs

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestRegistryConcurrentAliasUpsertsPreserveStoredIdentity(t *testing.T) {
	base := t.TempDir()
	project := filepath.Join(base, "real-project")
	if err := os.Mkdir(project, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(base, "old-alias")
	if err := os.Symlink(project, alias); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	file := filepath.Join(base, "registry.json")
	registry := NewRegistry(file)
	old, err := registry.UpsertWithMetaLocation(alias, MetaLocationHome)
	if err != nil {
		t.Fatal(err)
	}
	registry = NewRegistry(file)
	if err := registry.Load(); err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for i := 0; i < 8; i++ {
		group.Go(func() {
			got, err := registry.UpsertWithMetaLocation(project, MetaLocationProject)
			if err != nil || got.ID != old.ID || got.RootPath != old.RootPath || got.MetaLocation != MetaLocationHome {
				t.Errorf("upsert changed stored identity: %+v, %v", got, err)
			}
		})
	}
	group.Wait()
	if roots := registry.List(); len(roots) != 1 {
		t.Fatalf("concurrent alias upserts created duplicate roots: %+v", roots)
	}
	if err := registry.Load(); err != nil {
		t.Fatal(err)
	}
	if roots := registry.List(); len(roots) != 1 || roots[0].ID != old.ID {
		t.Fatalf("persisted identity changed: %+v", roots)
	}
}
