package gitview

import (
	"context"
	"fmt"
	"log"
	"mindfs/server/internal/fs"
	"strings"
	"time"
	"unicode/utf8"
)

func runGit(ctx context.Context, dir string, args ...string) (string, error) {
	out, err := runGitBytes(ctx, dir, args...)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func runGitBytes(ctx context.Context, dir string, args ...string) ([]byte, error) {
	// Add timeout if not already set (30 seconds for Windows compatibility)
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
	}
	cmd := newGitCommand(ctx, append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[git] command.error dir=%q args=%q err=%v output=%q", dir, append([]string{"-C", dir}, args...), err, logSnippet(string(out)))
		return nil, formatGitError(err, out)
	}
	return out, nil
}

func decodeGitDiffOutput(out []byte, ext string) string {
	if utf8.Valid(out) {
		return string(out)
	}
	if decoded, _, ok := fs.TryDecodeText(out, ext); ok {
		return decoded
	}
	return string(out)
}

func formatGitError(err error, output []byte) error {
	text := strings.TrimSpace(string(output))
	if text == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, text)
}

func isNotRepoError(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not a git repository")
}

func pathJoinSlash(parts ...string) string {
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) == "" {
			continue
		}
		filtered = append(filtered, strings.Trim(part, "/"))
	}
	return strings.Join(filtered, "/")
}

// logSnippet keeps failure output short: git errors can quote file content.
func logSnippet(output string) string {
	output = strings.TrimSpace(output)
	if len(output) > 300 {
		return output[:300] + "...(truncated)"
	}
	return output
}
