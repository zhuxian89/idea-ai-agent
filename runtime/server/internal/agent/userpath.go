package agent

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Agent installers put their programs in per-user directories that a service often does not
// have on its PATH: the scheduled task, launch agent or systemd unit keeps the PATH it had when
// it was installed, and an installer that runs later (for example Claude Code's native
// installer, which uses ~/.local/bin) creates the directory afterwards. The plugin adds the
// same directories for the runtime it starts; this does it for the backend itself, so that
// detection, version checks and sessions all look in the same places.

// userBinDirs returns the directories to search after the ones already on the PATH.
func userBinDirs(goos, home string, getenv func(string) string) []string {
	if home == "" {
		return nil
	}
	join := func(elem ...string) string { return filepath.Join(elem...) }
	switch goos {
	case "windows":
		profile := strings.TrimRight(firstNonEmpty(getenv("USERPROFILE"), home), `\/`)
		dirs := []string{profile + `\.local\bin`}
		if appData := strings.TrimRight(getenv("APPDATA"), `\/`); appData != "" {
			dirs = append(dirs, appData+`\npm`)
		}
		if local := strings.TrimRight(getenv("LOCALAPPDATA"), `\/`); local != "" {
			// Antigravity's official Windows installer puts agy.exe here.
			dirs = append(dirs, local+`\agy\bin`)
		}
		return dirs
	case "darwin":
		return []string{join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"}
	default:
		return []string{join(home, ".local", "bin"), "/usr/local/bin"}
	}
}

// extendPath appends the directories that are not on the PATH yet, keeping the existing order
// (the user's own PATH wins) and never listing a directory twice.
func extendPath(current string, extra []string, separator string, foldCase bool) string {
	key := func(dir string) string {
		if foldCase {
			return strings.ToLower(dir)
		}
		return dir
	}
	seen := map[string]bool{}
	var parts []string
	for _, dir := range strings.Split(current, separator) {
		if strings.TrimSpace(dir) == "" || seen[key(dir)] {
			continue
		}
		seen[key(dir)] = true
		parts = append(parts, dir)
	}
	for _, dir := range extra {
		if dir == "" || seen[key(dir)] {
			continue
		}
		seen[key(dir)] = true
		parts = append(parts, dir)
	}
	return strings.Join(parts, separator)
}

// AddUserBinDirsToPath extends this process's PATH. Directories that do not exist yet are
// included on purpose: an installer started from the backend creates them while it runs.
func AddUserBinDirsToPath() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	windows := runtime.GOOS == "windows"
	separator := string(os.PathListSeparator)
	next := extendPath(os.Getenv("PATH"), userBinDirs(runtime.GOOS, home, os.Getenv), separator, windows)
	return os.Setenv("PATH", next)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
