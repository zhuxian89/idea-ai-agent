package usecase

import (
	"context"
	"encoding/base64"
	"errors"
	"log"
	"strings"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/turndiff"
)

type TurnDiffArtifactInput struct {
	RootID     string
	Key        string
	SnapshotID string
	Path       string
}

type TurnDiffArtifactSide struct {
	Present bool   `json:"present"`
	Binary  bool   `json:"binary"`
	Mode    uint32 `json:"mode"`
	Data    string `json:"dataBase64,omitempty"`
}

type TurnDiffArtifactFile struct {
	Path   string               `json:"path"`
	Before TurnDiffArtifactSide `json:"before"`
	After  TurnDiffArtifactSide `json:"after"`
}

func finishWorkspaceTurnDiff(before *turndiff.Snapshot, native *agenttypes.TurnDiffUpdate, root fs.RootInfo, sessionKey string, mapPath func(string) string) *agenttypes.TurnDiffUpdate {
	if before == nil {
		return native
	}
	// Capture partial edits even if the user stopped the turn. Finish has its
	// own short timeout and never controls the native turn's cancellation.
	observed, err := before.Finish(context.Background())
	if err != nil {
		log.Printf("[session/diff] finish.unavailable session=%s err=%v", sessionKey, err)
		return native
	}
	update := agenttypes.TurnDiffUpdate{Workspace: true, Partial: observed.Partial}
	if mapPath != nil {
		observed.MapPaths(mapPath)
	}
	if artifactDir := root.MetaDir(); artifactDir != "" {
		if _, err := root.EnsureMetaDir(); err == nil {
			changedFiles := observed.ChangedFiles()
			if snapshotID, err := turndiff.SaveArtifact(artifactDir, sessionKey, changedFiles); err != nil {
				log.Printf("[session/diff] artifact.unavailable session=%s err=%v", sessionKey, err)
			} else if snapshotID != "" {
				update.SnapshotID = snapshotID
				for _, file := range changedFiles {
					if !file.Before.Binary && !file.After.Binary && (file.Before.Present || file.After.Present) {
						update.ComparePaths = append(update.ComparePaths, file.Path)
					}
				}
			}
		}
	}
	if native != nil {
		update.TurnID = native.TurnID
		update.Diff = native.Diff
	}
	update.Diff = observed.Merge(update.Diff)
	return &update
}

func (s *Service) GetTurnDiffArtifact(ctx context.Context, in TurnDiffArtifactInput) (*TurnDiffArtifactFile, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	in.RootID = strings.TrimSpace(in.RootID)
	in.Key = strings.TrimSpace(in.Key)
	in.SnapshotID = strings.TrimSpace(in.SnapshotID)
	in.Path = strings.TrimSpace(in.Path)
	if in.RootID == "" || in.Key == "" || in.SnapshotID == "" || in.Path == "" {
		return nil, errors.New("root, session, snapshot and path are required")
	}
	root, err := s.Registry.GetRoot(in.RootID)
	if err != nil {
		return nil, err
	}
	if err := root.ValidateRelativePath(in.Path); err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	if _, err := manager.Get(ctx, in.Key, 0); err != nil {
		return nil, err
	}
	file, err := turndiff.LoadArtifact(root.MetaDir(), in.Key, in.SnapshotID, in.Path)
	if err != nil {
		return nil, err
	}
	return &TurnDiffArtifactFile{
		Path:   file.Path,
		Before: turnDiffArtifactSide(file.Before),
		After:  turnDiffArtifactSide(file.After),
	}, nil
}

func turnDiffArtifactSide(value turndiff.FileState) TurnDiffArtifactSide {
	return TurnDiffArtifactSide{
		Present: value.Present,
		Binary:  value.Binary,
		Mode:    value.Mode,
		Data:    base64.StdEncoding.EncodeToString(value.Bytes),
	}
}
