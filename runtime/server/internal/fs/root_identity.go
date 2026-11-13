package fs

import "os"

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
