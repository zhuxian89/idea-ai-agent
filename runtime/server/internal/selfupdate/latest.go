package selfupdate

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// latestTimeout bounds one lookup of the published version.
const latestTimeout = 15 * time.Second

// maxVersionFile is far more than any version number; a bigger answer is not one.
const maxVersionFile = 256

// versionURL is where the project publishes the default standalone version. It sits next to the
// install scripts, so a test (or a mirror) that moves the scripts moves this with them.
func versionURL() string {
	base := defaultScriptBase
	if value := strings.TrimRight(os.Getenv(scriptBaseEnv), "/"); value != "" {
		base = value + "/"
	}
	return base + "standalone/version.txt"
}

// Latest reads the version the project currently publishes as the default standalone release.
//
// The node asks, not the browser: this machine is the one that downloads the update, so if it
// cannot reach the project the update cannot work anyway, while a phone that cannot reach GitHub
// (a very different network) says nothing about the update. The error names what failed.
func (u *Updater) Latest(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, latestTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, versionURL(), nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Cache-Control", "no-cache")
	response, err := u.httpClient().Do(request)
	if err != nil {
		return "", fmt.Errorf("could not reach the published version: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the published version returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxVersionFile+1))
	if err != nil {
		return "", fmt.Errorf("could not read the published version: %w", err)
	}
	version := strings.TrimSpace(string(body))
	if len(body) > maxVersionFile || !releaseVersion.MatchString(version) {
		return "", fmt.Errorf("the published version is not a release number")
	}
	return version, nil
}

func (u *Updater) httpClient() *http.Client {
	if u.client != nil {
		return u.client
	}
	return http.DefaultClient
}
