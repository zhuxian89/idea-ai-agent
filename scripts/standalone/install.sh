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
if [ "$defer_start" = --defer-start ]; then
  if [ -e "$prefix/local-ai-agent" ]; then
    printf '%s\n' 'Local AI Agent is already installed. Use the existing service or close IDEA before upgrading.' >&2
    exit 1
  fi
else
  # Use the incoming CLI to preserve the running address when updating older versions.
  "$source_dir/local-ai-agent" -stop
  printf '%s\n' 'Waiting for the local data service to stop...'
  "$source_dir/local-ai-agent" -stop-core
fi
if [ "$prefix" != "$source_dir" ]; then
  cp "$source_dir/local-ai-agent" "$prefix/local-ai-agent"
  chmod 755 "$prefix/local-ai-agent"
  rm -rf "$prefix/web"
  cp -R "$source_dir/web" "$prefix/web"
  cp "$source_dir/agents.json" "$source_dir/task_template.json" "$source_dir/LICENSE" "$source_dir/NOTICE.md" "$prefix/"
  cp -R "$source_dir/licenses" "$prefix/"
fi
"$prefix/local-ai-agent" -install
if [ "$defer_start" = --defer-start ]; then
  printf 'Local AI Agent installed. Restart all IDEA instances to use it: %s\n' "$prefix"
else
  "$prefix/local-ai-agent" -no-browser
  printf 'Local AI Agent installed and started: %s\n' "$prefix"
fi
