#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv="$here/.venv"

if [ ! -x "$venv/bin/python" ]; then
  "$here/setup.sh"
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  from_zshrc="$(grep -oE 'GEMINI_API_KEY="[^"]+"' "$HOME/.zshrc" 2>/dev/null | head -1 | sed -E 's/.*="([^"]+)"/\1/' || true)"
  if [ -n "$from_zshrc" ]; then
    export GEMINI_API_KEY="$from_zshrc"
  fi
fi

export PYTHONWARNINGS="${PYTHONWARNINGS:-ignore}"
exec "$venv/bin/python" "$@"
