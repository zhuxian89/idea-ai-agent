#!/bin/sh
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prefix=${1:-}
defer_start=${2:-}
case "$defer_start" in ''|--defer-start) ;; *) printf '%s\n' 'Unknown installation option.' >&2; exit 1;; esac
if [ -z "$prefix" ]; then
  prefix=$("$source_dir/local-ai-agent" -installation-dir)
  prefix=${prefix:-"$HOME/.local/share/LocalAIAgent"}
fi
case "$prefix" in /|""|"$HOME") printf '%s\n' 'Choose a dedicated Local AI Agent installation directory.' >&2; exit 1;; esac
mkdir -p "$prefix"
prefix=$(CDPATH= cd -- "$prefix" && pwd)
# Keep the path the user gave, but refuse by the real location: a link that points at the
# home directory (or at /) must be refused too, because the installer deletes "$prefix/web".
physical_home=$(CDPATH= cd -- "$HOME" && pwd -P)
physical_prefix=$(CDPATH= cd -- "$prefix" && pwd -P)
case "$prefix:$physical_prefix" in /:*|*:/|"$HOME":*|*:"$HOME"|*:"$physical_home") printf '%s\n' 'Choose a dedicated Local AI Agent installation directory.' >&2; exit 1;; esac
stage="$prefix/.upgrade"
stopped=
swapped=
# Leave the machine usable when the installation stops half way: a first installation must
# not look installed on the next try, and an upgrade must not leave the remote node offline.
restore() {
  status=$?
  trap - 0
  if [ "$status" -ne 0 ]; then
    rm -rf "$stage"
    if [ "$defer_start" = --defer-start ]; then
      if [ -n "$swapped" ]; then rm -f "$prefix/local-ai-agent"; fi
    elif [ -n "$stopped" ] && [ -x "$prefix/local-ai-agent" ]; then
      printf '%s\n' 'Installation failed; restarting Local AI Agent...' >&2
      "$prefix/local-ai-agent" -no-browser >&2 || true
    fi
  fi
  exit "$status"
}
trap restore 0
trap 'exit 1' HUP INT TERM
if [ "$defer_start" = --defer-start ]; then
  if [ -e "$prefix/local-ai-agent" ]; then
    printf '%s\n' 'Local AI Agent is already installed. Use the existing service or close IDEA before upgrading.' >&2
    exit 1
  fi
else
  stopped=1
  # Use the incoming CLI to preserve the running address when updating older versions.
  "$source_dir/local-ai-agent" -stop
  printf '%s\n' 'Waiting for the local data service to stop...'
  "$source_dir/local-ai-agent" -stop-core
fi
if [ "$prefix" != "$source_dir" ]; then
  # Copy everything aside first, so a failed copy leaves the previous installation untouched,
  # then move each item into place. Renaming also replaces a binary that is still mapped.
  rm -rf "$stage"
  mkdir "$stage"
  cp "$source_dir/local-ai-agent" "$stage/local-ai-agent"
  chmod 755 "$stage/local-ai-agent"
  cp -R "$source_dir/web" "$source_dir/licenses" "$stage/"
  cp "$source_dir/agents.json" "$source_dir/task_template.json" "$source_dir/LICENSE" "$source_dir/NOTICE.md" "$stage/"
  swapped=1
  rm -rf "$prefix/web" "$prefix/licenses"
  for name in web licenses agents.json task_template.json LICENSE NOTICE.md local-ai-agent; do
    mv -f "$stage/$name" "$prefix/$name"
  done
  rmdir "$stage"
fi
"$prefix/local-ai-agent" -install
if [ "$defer_start" = --defer-start ]; then
  printf 'Local AI Agent installed. Restart all IDEA instances to use it: %s\n' "$prefix"
else
  "$prefix/local-ai-agent" -no-browser
  printf 'Local AI Agent installed and started: %s\n' "$prefix"
  if [ "$(uname -s)" = Linux ] && ! "$prefix/local-ai-agent" -bind; then
    bind_path=$(printf '%s' "$prefix/local-ai-agent" | sed "s/'/'\"'\"'/g")
    printf "To retry remote binding, run:\n  '%s' -bind\n" "$bind_path" >&2
  fi
fi
