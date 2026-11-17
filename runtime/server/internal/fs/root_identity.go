package fs

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// NewRootInfoForPath keeps existing identities and allocates a separate ID for
// a different directory with the same display name.
func NewRootInfoForPath(roots []RootInfo, path string) (RootInfo, error) {
	if root, found := FindRootByPath(roots, path); found {
		return root, nil
	}
	name := filepath.Base(path)
	if !validRootID(name) {
		return RootInfo{}, errors.New("invalid directory name")
	}
	available := func(id string) (bool, bool, error) {
		for _, root := range roots {
			if root.ID == id || (runtime.GOOS == "windows" && strings.EqualFold(root.ID, id)) {
				return false, false, nil
			}
		}
		return rootIDMetadataAvailable(id, path)
	}
	identityPath := cleanRegistryPath(path)
	if runtime.GOOS == "windows" {
		identityPath = strings.ToLower(identityPath)
	}
	digest := sha256.Sum256([]byte(identityPath))
	// 截取 12 位摘要保持 ID 简短；同名路径摘要已被占用时继续分配，不能覆盖已有记录。
	baseID := fmt.Sprintf("%s-%x", name, digest[:6])
	id := baseID
	for suffix := 2; ; suffix++ {
		free, reused, err := available(id)
		if err != nil {
			return RootInfo{}, err
		}
		if free {
			// 移除后重新添加时，优先找回该路径已有的 home 数据，避免换 ID 后丢失历史入口。
			if !reused {
				nameFree, _, err := available(name)
				if err != nil {
					return RootInfo{}, err
				}
				if nameFree {
					id = name
				}
			}
			return NewRootInfo(id, name, path), nil
		}
		id = fmt.Sprintf("%s-%d", baseID, suffix)
	}
}

func rootIDMetadataAvailable(id, path string) (bool, bool, error) {
	metaDir, err := homeMetaDir(id)
	if err != nil {
		return false, false, err
	}
	identityPath := filepath.Join(metaDir, homeMetaIdentityFile)
	payload, err := os.ReadFile(identityPath)
	if err == nil {
		var identity homeMetaIdentity
		if err := json.Unmarshal(payload, &identity); err != nil {
			return false, false, fmt.Errorf("read metadata identity %s: %w", identityPath, err)
		}
		same := sameProjectIdentityPath(identity.RootPath, path)
		return same, same, nil
	}
	if !os.IsNotExist(err) {
		return false, false, err
	}
	entries, err := os.ReadDir(metaDir)
	if os.IsNotExist(err) {
		return true, false, nil
	}
	if err != nil {
		return false, false, err
	}
	// 未登记但仍有数据的 home 目录也不能被另一项目占用。
	return len(entries) == 0, false, nil
}

// FindRootByPath preserves the registered ID and metadata location when a
// directory is reopened through a symlink or a different filesystem spelling.
func FindRootByPath(roots []RootInfo, path string) (RootInfo, bool) {
	for _, root := range roots {
		if sameRootDirectory(root.RootPath, path) {
			return root, true
		}
	}
	return RootInfo{}, false
}

func sameRootDirectory(left, right string) bool {
	if sameRegistryPath(left, right) {
		return true
	}
	a, err := os.Stat(left)
	if err != nil {
		return false
	}
	b, err := os.Stat(right)
	return err == nil && os.SameFile(a, b)
}
