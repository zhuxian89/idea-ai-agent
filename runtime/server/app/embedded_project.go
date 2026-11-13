package app

import (
	"os"
	"path/filepath"

	"mindfs/server/internal/config"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/remotehost"
)

func registerEmbeddedProject(registry *fs.Registry, projectPath string) (fs.RootInfo, error) {
	hostDir := os.Getenv("IDE_AGENT_REMOTE_HOST_DIR")
	if hostDir == "" {
		var err error
		hostDir, err = remotehost.DefaultDir()
		if err != nil {
			return fs.RootInfo{}, err
		}
	}
	dataDir, err := config.MindFSConfigDir()
	if err != nil {
		return fs.RootInfo{}, err
	}
	for _, dir := range []string{hostDir, dataDir} {
		previous := fs.NewRegistry(filepath.Join(dir, "registry.json"))
		if err := previous.Load(); err != nil {
			return fs.RootInfo{}, err
		}
		if root, found := fs.FindRootByPath(previous.List(), projectPath); found {
			return root, registry.UseOnly(root)
		}
	}
	location, err := fs.MetaLocationForNewRoot(projectPath, fs.MetaLocationProject)
	if err != nil {
		return fs.RootInfo{}, err
	}
	return registry.UpsertWithMetaLocation(projectPath, location)
}
