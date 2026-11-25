package update

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	defaultCheckInterval = time.Hour
	releaseNotesPath     = "release-notes.md"
	relayDownloadBase    = "https://relay.20260310.best/mindfs-downloads"
)

var releaseManifestPublicKey string

type Status struct {
	CurrentVersion      string    `json:"current_version"`
	LatestVersion       string    `json:"latest_version,omitempty"`
	HasUpdate           bool      `json:"has_update"`
	Status              string    `json:"status"`
	Message             string    `json:"message,omitempty"`
	ReleaseName         string    `json:"release_name,omitempty"`
	ReleaseBody         string    `json:"release_body,omitempty"`
	ReleaseURL          string    `json:"release_url,omitempty"`
	PublishedAt         time.Time `json:"published_at,omitempty"`
	LastCheckedAt       time.Time `json:"last_checked_at,omitempty"`
	AutoUpdateSupported bool      `json:"auto_update_supported"`
}

type Service struct {
	repo          string
	current       string
	executable    string
	args          []string
	checkInterval time.Duration
	client        *http.Client

	mu        sync.RWMutex
	status    Status
	listeners []func(Status)
}

type latestRelease struct {
	TagName     string         `json:"tag_name"`
	Name        string         `json:"name"`
	Body        string         `json:"body"`
	HTMLURL     string         `json:"html_url"`
	PublishedAt time.Time      `json:"published_at"`
	Assets      []releaseAsset `json:"assets"`
}

type releaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type releaseManifest struct {
	Version   string             `json:"version"`
	Repo      string             `json:"repo,omitempty"`
	Artifacts []manifestArtifact `json:"artifacts"`
}

type signedReleaseManifest struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}

type manifestArtifact struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size,omitempty"`
}

type installLayout struct {
	Mode   string
	Prefix string
	ExeDir string
}

func NewService(repo, currentVersion, executable string, args []string, interval time.Duration) *Service {
	if interval <= 0 {
		interval = defaultCheckInterval
	}
	currentVersion = strings.TrimSpace(currentVersion)
	if currentVersion == "" {
		currentVersion = "dev"
	}
	s := &Service{
		repo:          strings.TrimSpace(repo),
		current:       currentVersion,
		executable:    strings.TrimSpace(executable),
		args:          append([]string(nil), args...),
		checkInterval: interval,
		client: &http.Client{
			Timeout: 10 * time.Minute,
		},
	}
	st := Status{
		CurrentVersion:      currentVersion,
		Status:              "idle",
		AutoUpdateSupported: s.canAutoUpdate(),
	}
	if !st.AutoUpdateSupported {
		st.Message = s.unsupportedMessage()
	}
	s.status = st
	return s
}

func (s *Service) Start(ctx context.Context) {
	if s == nil || strings.TrimSpace(s.repo) == "" {
		return
	}
	go func() {
		log.Printf("[update] checker.start repo=%s current=%s interval=%s auto_update_supported=%t", s.repo, s.current, s.checkInterval, s.canAutoUpdate())
		s.CheckNow(context.Background())
		ticker := time.NewTicker(s.checkInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.CheckNow(context.Background())
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (s *Service) AddListener(listener func(Status)) {
	if s == nil || listener == nil {
		return
	}
	s.mu.Lock()
	s.listeners = append(s.listeners, listener)
	s.mu.Unlock()
}

func (s *Service) GetStatus() Status {
	if s == nil {
		return Status{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

func (s *Service) CheckNow(ctx context.Context) {
	if s == nil || strings.TrimSpace(s.repo) == "" {
		return
	}
	log.Printf("[update] check.begin repo=%s current=%s", s.repo, s.current)
	release, err := s.fetchLatestRelease(ctx)
	if err != nil {
		log.Printf("[update] check.error repo=%s current=%s err=%v", s.repo, s.current, err)
		s.updateStatus(func(st *Status) {
			st.LastCheckedAt = time.Now().UTC()
			if st.Status == "downloading" || st.Status == "installing" || st.Status == "restarting" {
				return
			}
			if st.HasUpdate {
				return
			}
			st.Status = "idle"
			if !st.AutoUpdateSupported {
				st.Message = s.unsupportedMessage()
			}
		})
		return
	}
	latest := normalizeVersion(release.TagName)
	current := normalizeVersion(s.current)
	hasUpdate := isNewerVersion(latest, current)
	log.Printf("[update] check.result repo=%s current=%s latest=%s has_update=%t", s.repo, current, latest, hasUpdate)
	s.updateStatus(func(st *Status) {
		st.CurrentVersion = s.current
		st.LatestVersion = latest
		st.ReleaseName = strings.TrimSpace(release.Name)
		st.ReleaseBody = strings.TrimSpace(release.Body)
		st.ReleaseURL = strings.TrimSpace(release.HTMLURL)
		st.PublishedAt = release.PublishedAt
		st.LastCheckedAt = time.Now().UTC()
		st.HasUpdate = hasUpdate
		st.AutoUpdateSupported = s.canAutoUpdate()
		if !st.AutoUpdateSupported {
			st.Message = s.unsupportedMessage()
		} else if hasUpdate && (st.Status == "" || st.Status == "idle" || st.Status == "available") {
			st.Message = ""
		}
		if st.Status == "downloading" || st.Status == "installing" || st.Status == "restarting" {
			return
		}
		if hasUpdate {
			st.Status = "available"
			return
		}
		st.Status = "idle"
		if st.AutoUpdateSupported {
			st.Message = ""
		}
	})
}

func (s *Service) TriggerUpdate(ctx context.Context) error {
	if s == nil {
		return errors.New("update service not configured")
	}
	st := s.GetStatus()
	if !st.AutoUpdateSupported {
		return errors.New(firstNonEmpty(st.Message, "auto update is not supported in this install mode"))
	}
	if !st.HasUpdate || strings.TrimSpace(st.LatestVersion) == "" {
		return errors.New("no update available")
	}
	if st.Status == "downloading" || st.Status == "installing" || st.Status == "restarting" {
		return errors.New("update already in progress")
	}

	s.updateStatus(func(st *Status) {
		st.Status = "downloading"
		st.Message = "Downloading update..."
	})

	go s.runUpdate(context.WithoutCancel(ctx), st.LatestVersion)
	return nil
}

func (s *Service) InstallLatest(ctx context.Context) (Status, error) {
	if s == nil {
		return Status{}, errors.New("update service not configured")
	}
	release, err := s.fetchLatestRelease(ctx)
	if err != nil {
		s.updateStatus(func(st *Status) {
			st.LastCheckedAt = time.Now().UTC()
			st.Status = "failed"
			st.Message = err.Error()
		})
		return s.GetStatus(), err
	}
	latest := normalizeVersion(release.TagName)
	current := normalizeVersion(s.current)
	hasUpdate := isNewerVersion(latest, current)
	s.updateStatus(func(st *Status) {
		st.CurrentVersion = s.current
		st.LatestVersion = latest
		st.ReleaseName = strings.TrimSpace(release.Name)
		st.ReleaseBody = strings.TrimSpace(release.Body)
		st.ReleaseURL = strings.TrimSpace(release.HTMLURL)
		st.PublishedAt = release.PublishedAt
		st.LastCheckedAt = time.Now().UTC()
		st.HasUpdate = hasUpdate
		st.AutoUpdateSupported = s.canAutoUpdate()
		if !st.AutoUpdateSupported {
			st.Status = "idle"
			st.Message = s.unsupportedMessage()
			return
		}
		st.Message = ""
		if hasUpdate {
			st.Status = "available"
			return
		}
		st.Status = "idle"
	})

	st := s.GetStatus()
	if !st.AutoUpdateSupported {
		return st, errors.New(firstNonEmpty(st.Message, "auto update is not supported in this install mode"))
	}
	if !st.HasUpdate || strings.TrimSpace(st.LatestVersion) == "" {
		return st, nil
	}
	if st.Status == "downloading" || st.Status == "installing" || st.Status == "restarting" {
		return st, errors.New("update already in progress")
	}

	s.updateStatus(func(st *Status) {
		st.Status = "downloading"
		st.Message = "Downloading update..."
	})
	if err := s.installUpdate(ctx, st.LatestVersion, false); err != nil {
		s.fail(err)
		return s.GetStatus(), err
	}
	s.updateStatus(func(st *Status) {
		st.Status = "installed"
		st.Message = "Update installed. Restart MindFS to use the new version."
	})
	return s.GetStatus(), nil
}

func (s *Service) runUpdate(ctx context.Context, version string) {
	if err := s.installUpdate(ctx, version, true); err != nil {
		s.fail(err)
	}
}

func (s *Service) installUpdate(ctx context.Context, version string, restart bool) error {
	release, err := s.fetchLatestRelease(ctx)
	if err != nil {
		return err
	}
	asset, err := s.pickAsset(release, version)
	if err != nil {
		return err
	}
	manifest, err := s.fetchAndVerifyManifest(ctx, version)
	if err != nil {
		return err
	}
	artifact, err := manifest.findArtifact(asset.Name)
	if err != nil {
		return err
	}

	tmpDir, err := os.MkdirTemp("", "mindfs-update-*")
	if err != nil {
		return err
	}
	cleanupTmpDir := true
	defer func() {
		if cleanupTmpDir {
			_ = os.RemoveAll(tmpDir)
		}
	}()

	archivePath := filepath.Join(tmpDir, asset.Name)
	if err := s.downloadReleaseAsset(ctx, asset, archivePath); err != nil {
		return err
	}
	if err := verifyFileSHA256(archivePath, artifact.SHA256, artifact.Size); err != nil {
		return err
	}

	s.updateStatus(func(st *Status) {
		st.Status = "installing"
		st.Message = "Installing update..."
	})

	extractDir := filepath.Join(tmpDir, "extract")
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		return err
	}
	if err := extractArchive(archivePath, extractDir); err != nil {
		return err
	}
	pkgDir, err := findPackageDir(extractDir)
	if err != nil {
		return err
	}
	if restart && runtime.GOOS == "windows" {
		s.updateStatus(func(st *Status) {
			st.Status = "restarting"
			st.Message = "Restarting service..."
		})
		if err := s.restartInstalledBinary(pkgDir); err != nil {
			return err
		}
		cleanupTmpDir = false
		return nil
	}
	if err := s.installPackage(pkgDir); err != nil {
		return err
	}
	if !restart {
		return nil
	}

	s.updateStatus(func(st *Status) {
		st.Status = "restarting"
		st.Message = "Restarting service..."
	})
	if err := s.restartInstalledBinary(""); err != nil {
		return err
	}
	return nil
}

func (s *Service) fail(err error) {
	msg := "update failed"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		msg = err.Error()
	}
	log.Printf("[update] run.error current=%s latest=%s err=%s", s.current, s.GetStatus().LatestVersion, msg)
	s.updateStatus(func(st *Status) {
		st.Status = "failed"
		st.Message = msg
	})
}

func (s *Service) updateStatus(apply func(*Status)) {
	s.mu.Lock()
	st := s.status
	apply(&st)
	s.status = st
	listeners := append([]func(Status){}, s.listeners...)
	s.mu.Unlock()
	for _, listener := range listeners {
		listener(st)
	}
}

func (s *Service) fetchLatestRelease(ctx context.Context) (latestRelease, error) {
	body, err := s.fetchRawText(ctx, releaseNotesPath, 1<<20)
	if err != nil {
		return latestRelease{}, err
	}
	tag := parseReleaseNotesVersion(body)
	if tag == "" {
		return latestRelease{}, fmt.Errorf("release check failed: no version found in %s", releaseNotesPath)
	}
	tag = normalizeTag(tag)
	return latestRelease{
		TagName: tag,
		Name:    tag,
		Body:    latestReleaseNotesBody(body),
		HTMLURL: fmt.Sprintf("https://github.com/%s/releases/tag/%s", s.repo, tag),
		Assets:  []releaseAsset{s.releaseAssetForVersion(tag)},
	}, nil
}

func (s *Service) fetchRawText(ctx context.Context, path string, limit int64) (string, error) {
	url := fmt.Sprintf("https://raw.githubusercontent.com/%s/main/%s", s.repo, strings.TrimPrefix(path, "/"))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "mindfs-update-checker")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("raw file fetch failed: %s", resp.Status)
	}
	if limit <= 0 {
		limit = 64 << 10
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func (s *Service) pickAsset(release latestRelease, version string) (releaseAsset, error) {
	ext := ".tar.gz"
	if runtime.GOOS == "windows" {
		ext = ".zip"
	}
	candidates := []string{
		fmt.Sprintf("mindfs_%s_%s_%s%s", version, runtime.GOOS, runtime.GOARCH, ext),
		fmt.Sprintf("mindfs_v%s_%s_%s%s", strings.TrimPrefix(version, "v"), runtime.GOOS, runtime.GOARCH, ext),
	}
	for _, asset := range release.Assets {
		name := strings.TrimSpace(asset.Name)
		for _, candidate := range candidates {
			if name == candidate {
				return asset, nil
			}
		}
	}
	return releaseAsset{}, fmt.Errorf(
		"release asset not found for %s/%s (candidates: %s)",
		runtime.GOOS,
		runtime.GOARCH,
		strings.Join(candidates, ", "),
	)
}

func (s *Service) releaseAssetForVersion(version string) releaseAsset {
	version = normalizeTag(version)
	ext := ".tar.gz"
	if runtime.GOOS == "windows" {
		ext = ".zip"
	}
	name := fmt.Sprintf("mindfs_%s_%s_%s%s", version, runtime.GOOS, runtime.GOARCH, ext)
	return releaseAsset{
		Name:               name,
		BrowserDownloadURL: fmt.Sprintf("https://github.com/%s/releases/download/%s/%s", s.repo, version, name),
	}
}

func (s *Service) fetchAndVerifyManifest(ctx context.Context, version string) (releaseManifest, error) {
	publicKey, err := updatePublicKey()
	if err != nil {
		return releaseManifest{}, err
	}
	version = normalizeTag(version)
	base := fmt.Sprintf("https://github.com/%s/releases/download/%s/mindfs_%s_manifest.json", s.repo, version, version)
	body, err := s.fetchURL(ctx, base, 4<<20)
	if err != nil {
		return releaseManifest{}, err
	}
	var envelope signedReleaseManifest
	if err := json.Unmarshal(body, &envelope); err != nil {
		return releaseManifest{}, fmt.Errorf("release manifest envelope invalid: %w", err)
	}
	if strings.TrimSpace(envelope.Payload) == "" || strings.TrimSpace(envelope.Signature) == "" {
		return releaseManifest{}, errors.New("release manifest envelope missing payload or signature")
	}
	payload, err := decodeBase64String(envelope.Payload)
	if err != nil {
		return releaseManifest{}, fmt.Errorf("release manifest payload invalid: %w", err)
	}
	signature, err := decodeBase64String(envelope.Signature)
	if err != nil {
		return releaseManifest{}, fmt.Errorf("release manifest signature invalid: %w", err)
	}
	if !ed25519.Verify(publicKey, payload, signature) {
		return releaseManifest{}, errors.New("release manifest signature verification failed")
	}
	var manifest releaseManifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return releaseManifest{}, fmt.Errorf("release manifest invalid: %w", err)
	}
	if normalizeTag(manifest.Version) != version {
		return releaseManifest{}, fmt.Errorf("release manifest version mismatch: got %q want %q", manifest.Version, version)
	}
	return manifest, nil
}

func (s *Service) downloadReleaseAsset(ctx context.Context, asset releaseAsset, dst string) error {
	primaryURL := strings.TrimSpace(asset.BrowserDownloadURL)
	if primaryURL == "" {
		return errors.New("release asset download URL unavailable")
	}
	if err := s.downloadFile(ctx, primaryURL, dst); err == nil {
		return nil
	} else {
		fallbackURL := relayAssetURL(asset.Name)
		if fallbackURL == "" || fallbackURL == primaryURL {
			return err
		}
		log.Printf("[update] download.github_failed asset=%s err=%v fallback=%s", strings.TrimSpace(asset.Name), err, fallbackURL)
		_ = os.Remove(dst)
		if fallbackErr := s.downloadFile(ctx, fallbackURL, dst); fallbackErr != nil {
			return fmt.Errorf("download failed from GitHub (%v) and relay fallback (%v)", err, fallbackErr)
		}
		return nil
	}
}

func relayAssetURL(name string) string {
	name = strings.TrimSpace(name)
	if name == "" || strings.ContainsAny(name, `/\`) {
		return ""
	}
	return strings.TrimRight(relayDownloadBase, "/") + "/" + name
}

func (s *Service) fetchURL(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "mindfs-updater")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("download failed: %s", resp.Status)
	}
	reader := io.Reader(resp.Body)
	if limit > 0 {
		reader = io.LimitReader(resp.Body, limit+1)
	}
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if limit > 0 && int64(len(body)) > limit {
		return nil, fmt.Errorf("download exceeds size limit: %d bytes", limit)
	}
	return body, nil
}

func (s *Service) installPackage(pkgDir string) error {
	layout, err := s.installLayout()
	if err != nil {
		return err
	}
	binName := "mindfs"
	if runtime.GOOS == "windows" {
		binName = "mindfs.exe"
	}
	srcBin := filepath.Join(pkgDir, binName)
	if _, err := os.Stat(srcBin); err != nil {
		return fmt.Errorf("updated binary missing: %w", err)
	}
	dstBin, dstAgents, dstTaskTemplate, dstWeb := layout.destinationPaths(binName)
	if err := os.MkdirAll(filepath.Dir(dstBin), 0o755); err != nil {
		return err
	}
	if err := replaceFile(srcBin, dstBin, 0o755); err != nil {
		return err
	}
	srcWeb := filepath.Join(pkgDir, "web")
	if info, err := os.Stat(srcWeb); err == nil && info.IsDir() {
		if err := os.RemoveAll(dstWeb); err != nil {
			return err
		}
		if err := copyDir(srcWeb, dstWeb); err != nil {
			return err
		}
	}
	srcAgents := filepath.Join(pkgDir, "agents.json")
	if info, err := os.Stat(srcAgents); err == nil && !info.IsDir() {
		if err := os.MkdirAll(filepath.Dir(dstAgents), 0o755); err != nil {
			return err
		}
		if err := replaceFile(srcAgents, dstAgents, 0o644); err != nil {
			return err
		}
	}
	srcTaskTemplate := filepath.Join(pkgDir, "task_template.json")
	if info, err := os.Stat(srcTaskTemplate); err == nil && !info.IsDir() {
		if err := os.MkdirAll(filepath.Dir(dstTaskTemplate), 0o755); err != nil {
			return err
		}
		if err := replaceFile(srcTaskTemplate, dstTaskTemplate, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) restartInstalledBinary(pkgDir string) error {
	exe := s.executable
	if strings.TrimSpace(exe) == "" {
		return errors.New("current executable path unavailable")
	}
	layout, err := s.installLayout()
	if err != nil {
		return err
	}
	binName := "mindfs"
	if runtime.GOOS == "windows" {
		binName = "mindfs.exe"
	}
	dstBin, dstAgents, dstTaskTemplate, dstWeb := layout.destinationPaths(binName)
	log.Printf("[update] restart.begin exe=%s args=%q", exe, s.args)
	if err := startReplacementProcess(os.Getpid(), exe, s.args, os.Stdout, os.Stderr, pkgDir, dstBin, dstAgents, dstTaskTemplate, dstWeb); err != nil {
		return err
	}
	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}

func (s *Service) canAutoUpdate() bool {
	if strings.TrimSpace(s.executable) == "" {
		return false
	}
	if _, err := updatePublicKey(); err != nil {
		return false
	}
	base := strings.ToLower(filepath.Base(s.executable))
	if base != "mindfs" && base != "mindfs.exe" {
		return false
	}
	_, err := s.installLayout()
	return err == nil
}

func (s *Service) unsupportedMessage() string {
	if _, err := updatePublicKey(); err != nil {
		return "Auto update is unavailable because the release verification public key is not configured."
	}
	base := strings.ToLower(filepath.Base(s.executable))
	if base != "mindfs" && base != "mindfs.exe" {
		return "Auto update is only available for mindfs release binaries."
	}
	return "Auto update is unavailable for the current install path."
}

func (s *Service) installLayout() (installLayout, error) {
	exe := strings.TrimSpace(s.executable)
	if exe == "" {
		return installLayout{}, errors.New("executable path required")
	}
	base := strings.ToLower(filepath.Base(exe))
	if base != "mindfs" && base != "mindfs.exe" {
		return installLayout{}, errors.New("unsupported executable name")
	}
	exeDir := filepath.Dir(exe)
	if strings.ToLower(filepath.Base(exeDir)) == "bin" {
		return installLayout{
			Mode:   "installed",
			Prefix: filepath.Dir(exeDir),
			ExeDir: exeDir,
		}, nil
	}
	return installLayout{
		Mode:   "portable",
		ExeDir: exeDir,
	}, nil
}

func (l installLayout) destinationPaths(binName string) (string, string, string, string) {
	if l.Mode == "installed" {
		return filepath.Join(l.Prefix, "bin", binName),
			filepath.Join(l.Prefix, "share", "mindfs", "agents.json"),
			filepath.Join(l.Prefix, "share", "mindfs", "task_template.json"),
			filepath.Join(l.Prefix, "share", "mindfs", "web")
	}
	return filepath.Join(l.ExeDir, binName),
		filepath.Join(l.ExeDir, "agents.json"),
		filepath.Join(l.ExeDir, "task_template.json"),
		filepath.Join(l.ExeDir, "web")
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	return v
}
