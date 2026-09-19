package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func ccSwitchCandidates(goos, home, localAppData, programFiles string) []string {
	switch goos {
	case "darwin":
		return []string{"/Applications/CC Switch.app", filepath.Join(home, "Applications", "CC Switch.app")}
	case "windows":
		var paths []string
		for _, base := range []string{localAppData, programFiles} {
			if base == "" {
				continue
			}
			for _, dir := range []string{"CC Switch", "cc-switch", filepath.Join("Programs", "CC Switch")} {
				paths = append(paths, filepath.Join(base, dir, "cc-switch.exe"))
			}
		}
		return paths
	default:
		return []string{filepath.Join(home, ".local", "bin", "cc-switch"), "/usr/bin/cc-switch", "/usr/local/bin/cc-switch"}
	}
}

func findCCSwitch(ctx context.Context) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	for _, path := range ccSwitchCandidates(runtime.GOOS, home, os.Getenv("LOCALAPPDATA"), os.Getenv("ProgramFiles")) {
		if info, err := os.Stat(path); err == nil && (runtime.GOOS == "darwin" || !info.IsDir()) {
			return path, nil
		}
	}
	if path, err := exec.LookPath("cc-switch"); err == nil {
		return path, nil
	}
	if runtime.GOOS == "darwin" {
		// Applications moved outside /Applications remain registered with Spotlight.
		output, err := exec.CommandContext(ctx, "/usr/bin/mdfind", "kMDItemCFBundleIdentifier == 'com.ccswitch.desktop'").Output()
		if err != nil {
			return "", err
		}
		for _, path := range strings.Split(strings.TrimSpace(string(output)), "\n") {
			if strings.HasSuffix(path, ".app") {
				if _, err := os.Stat(path); err == nil {
					return path, nil
				}
			}
		}
	}
	return "", nil
}

func (h *HTTPHandler) handleCCSwitchStatus(w http.ResponseWriter, r *http.Request) {
	if !requireDesktopRequest(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	path, err := findCCSwitch(ctx)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]bool{"installed": path != ""})
}

func launchCCSwitch(ctx context.Context, path string) error {
	if path == "" {
		return errors.New("CC Switch was not detected")
	}
	if runtime.GOOS == "darwin" {
		return exec.CommandContext(ctx, "/usr/bin/open", "-a", path).Run()
	}
	// No shell interpolation, arguments, credential writes, or deep-link imports.
	cmd := exec.Command(path)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func (h *HTTPHandler) handleCCSwitchOpen(w http.ResponseWriter, r *http.Request) {
	if !requireDesktopRequest(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	path, err := findCCSwitch(ctx)
	if err == nil && path == "" {
		respondError(w, http.StatusNotFound, errors.New("CC Switch was not detected"))
		return
	}
	if err == nil {
		err = launchCCSwitch(ctx, path)
	}
	if err != nil {
		respondError(w, http.StatusBadGateway, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]bool{"opened": true})
}
