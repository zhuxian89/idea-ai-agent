package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const maxUpdateCheckResponseBytes = 1 << 20

var versionPattern = regexp.MustCompile(`\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?`)

type UpdateCheckResult struct {
	Agent          string `json:"agent"`
	CurrentVersion string `json:"current_version"`
	LatestVersion  string `json:"latest_version"`
	HasUpdate      bool   `json:"has_update"`
}

// CheckUpdate reads latest-version metadata without executing an install or
// update command.
func CheckUpdate(ctx context.Context, def Definition, currentVersion string, client *http.Client) (UpdateCheckResult, error) {
	result := UpdateCheckResult{
		Agent:          strings.TrimSpace(def.Name),
		CurrentVersion: extractVersion(currentVersion),
	}
	if result.Agent == "" {
		return result, errors.New("agent required")
	}
	if result.CurrentVersion == "" {
		result.CurrentVersion = detectDefinitionVersion(def)
	}
	if result.CurrentVersion == "" {
		return result, errors.New("current agent version unavailable")
	}

	endpoint := strings.TrimSpace(def.UpdateCheck.URL)
	if endpoint == "" {
		return result, errors.New("update check is not supported for this agent")
	}
	parsedURL, err := url.Parse(endpoint)
	if err != nil || (parsedURL.Scheme != "https" && parsedURL.Scheme != "http") || parsedURL.Host == "" {
		return result, errors.New("invalid update check URL")
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return result, err
	}
	req.Header.Set("Accept", "application/json, text/plain;q=0.9")
	req.Header.Set("User-Agent", "MindFS-Agent-Update-Check")
	response, err := client.Do(req)
	if err != nil {
		return result, fmt.Errorf("check latest version: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return result, fmt.Errorf("check latest version: HTTP %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxUpdateCheckResponseBytes))
	if err != nil {
		return result, fmt.Errorf("read latest version: %w", err)
	}

	latest := strings.TrimSpace(string(payload))
	if field := strings.TrimSpace(def.UpdateCheck.JSONField); field != "" {
		var body map[string]any
		if err := json.Unmarshal(payload, &body); err != nil {
			return result, fmt.Errorf("decode latest version: %w", err)
		}
		value, ok := body[field]
		if !ok {
			return result, fmt.Errorf("latest version field %q missing", field)
		}
		latest = fmt.Sprint(value)
	}
	result.LatestVersion = extractVersion(latest)
	if result.LatestVersion == "" {
		return result, errors.New("latest agent version unavailable")
	}
	result.HasUpdate = isVersionNewer(result.LatestVersion, result.CurrentVersion)
	return result, nil
}

func detectDefinitionVersion(def Definition) string {
	if strings.TrimSpace(def.Command) == "" || len(def.VersionArgs) == 0 {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, def.Command, def.VersionArgs...)
	if len(def.Env) > 0 {
		command.Env = os.Environ()
		for key, value := range def.Env {
			command.Env = append(command.Env, key+"="+value)
		}
	}
	output, err := command.CombinedOutput()
	if err != nil {
		return ""
	}
	return extractVersion(string(output))
}

func extractVersion(value string) string {
	return versionPattern.FindString(strings.TrimSpace(value))
}

func isVersionNewer(latest, current string) bool {
	latestCore, latestPre, latestOK := splitVersion(latest)
	currentCore, currentPre, currentOK := splitVersion(current)
	if !latestOK || !currentOK {
		return false
	}
	maxParts := len(latestCore)
	if len(currentCore) > maxParts {
		maxParts = len(currentCore)
	}
	for index := 0; index < maxParts; index++ {
		latestPart := 0
		currentPart := 0
		if index < len(latestCore) {
			latestPart = latestCore[index]
		}
		if index < len(currentCore) {
			currentPart = currentCore[index]
		}
		if latestPart != currentPart {
			return latestPart > currentPart
		}
	}
	if latestPre == currentPre {
		return false
	}
	if latestPre == "" {
		return true
	}
	if currentPre == "" {
		return false
	}
	return comparePrerelease(latestPre, currentPre) > 0
}

func splitVersion(value string) ([]int, string, bool) {
	normalized := extractVersion(value)
	if normalized == "" {
		return nil, "", false
	}
	core, prerelease, _ := strings.Cut(normalized, "-")
	segments := strings.Split(core, ".")
	parts := make([]int, 0, len(segments))
	for _, segment := range segments {
		part, err := strconv.Atoi(segment)
		if err != nil {
			return nil, "", false
		}
		parts = append(parts, part)
	}
	return parts, prerelease, true
}

func comparePrerelease(left, right string) int {
	leftParts := strings.Split(left, ".")
	rightParts := strings.Split(right, ".")
	maxParts := len(leftParts)
	if len(rightParts) > maxParts {
		maxParts = len(rightParts)
	}
	for index := 0; index < maxParts; index++ {
		if index >= len(leftParts) {
			return -1
		}
		if index >= len(rightParts) {
			return 1
		}
		leftNumber, leftErr := strconv.Atoi(leftParts[index])
		rightNumber, rightErr := strconv.Atoi(rightParts[index])
		switch {
		case leftErr == nil && rightErr == nil && leftNumber != rightNumber:
			if leftNumber > rightNumber {
				return 1
			}
			return -1
		case leftErr == nil && rightErr != nil:
			return -1
		case leftErr != nil && rightErr == nil:
			return 1
		case leftParts[index] != rightParts[index]:
			return strings.Compare(leftParts[index], rightParts[index])
		}
	}
	return 0
}
