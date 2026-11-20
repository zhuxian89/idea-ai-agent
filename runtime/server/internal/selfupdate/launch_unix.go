//go:build !windows

package selfupdate

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

// The script is downloaded to a file first: `curl | sh` would report success when the download
// failed, because the shell at the end of the pipe sees an empty script. The wrapper records the
// exit code so the next process can tell success from failure.
const wrapperScript = `
case "$1" in
  https://*) set -- "$1" "$2" "$3" --proto '=https' --proto-redir '=https' ;;
esac
url=$1 version=$2 result=$3
shift 3
f=$(mktemp) && curl -fsSL "$@" "$url" -o "$f" && sh "$f" --version "$version"
code=$?
rm -f "$f"
printf '%s\n' "$code" > "$result.tmp" && mv "$result.tmp" "$result"
exit "$code"`

// launchDetached runs the install command outside this process. The command stops this service,
// so it must not be a child that dies with it.
func launchDetached(p plan) error {
	args := []string{"-c", wrapperScript, "sh", p.ScriptURL, p.Version, p.ExitFile}
	if started, err := launchSystemd(p, args); started || err != nil {
		return err
	}
	log, err := os.OpenFile(p.LogFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer log.Close()
	cmd := exec.Command("/bin/sh", args...)
	cmd.Stdout, cmd.Stderr = log, log
	// A new session takes it out of the service's process group, which launchd and a terminal stop together.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start installer: %w", err)
	}
	return cmd.Process.Release()
}
