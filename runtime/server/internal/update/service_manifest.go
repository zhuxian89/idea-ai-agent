package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

func updatePublicKey() (ed25519.PublicKey, error) {
	encoded := strings.TrimSpace(releaseManifestPublicKey)
	if encoded == "" {
		return nil, errors.New("auto update requires a configured release manifest public key")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		raw, err = base64.RawStdEncoding.DecodeString(encoded)
	}
	if err != nil {
		return nil, fmt.Errorf("release manifest public key invalid: %w", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("release manifest public key invalid length: got %d want %d", len(raw), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(raw), nil
}

func (m releaseManifest) findArtifact(name string) (manifestArtifact, error) {
	for _, artifact := range m.Artifacts {
		if strings.TrimSpace(artifact.Name) == name {
			if _, err := parseSHA256Hex(artifact.SHA256); err != nil {
				return manifestArtifact{}, fmt.Errorf("release manifest artifact %s invalid sha256: %w", name, err)
			}
			return artifact, nil
		}
	}
	return manifestArtifact{}, fmt.Errorf("release manifest missing artifact: %s", name)
}

func verifyFileSHA256(path, wantHex string, wantSize int64) error {
	want, err := parseSHA256Hex(wantHex)
	if err != nil {
		return err
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return err
	}
	if wantSize > 0 && size != wantSize {
		return fmt.Errorf("downloaded artifact size mismatch: got %d want %d", size, wantSize)
	}
	if got := hash.Sum(nil); !bytesEqual(got, want) {
		return errors.New("downloaded artifact sha256 verification failed")
	}
	return nil
}

func parseSHA256Hex(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if len(value) != sha256.Size*2 {
		return nil, fmt.Errorf("got %d hex chars want %d", len(value), sha256.Size*2)
	}
	out, err := hex.DecodeString(value)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func decodeBase64String(value string) ([]byte, error) {
	encoded := strings.TrimSpace(value)
	out, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		out, err = base64.RawStdEncoding.DecodeString(encoded)
	}
	return out, err
}

func (s *Service) downloadFile(ctx context.Context, url, dst string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "mindfs-updater")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download failed: %s", resp.Status)
	}
	file, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, resp.Body)
	return err
}
