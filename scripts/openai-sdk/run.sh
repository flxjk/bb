#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$here/node_modules/openai" ]; then
  (cd "$here" && pnpm install --ignore-workspace)
fi

from_zshrc() {
  grep -oE "$1=\"[^\"]+\"" "$HOME/.zshrc" 2>/dev/null |
    head -1 |
    sed -E 's/.*="([^"]+)"/\1/' || true
}

from_bb_secret() {
  local path
  for path in \
    "$HOME/.bb/plugins/bb--local-stack/secrets/$1" \
    "$HOME"/.bb-dev/*/plugins/bb--local-stack/secrets/"$1"; do
    if [ -f "$path" ]; then
      tr -d '\n' <"$path"
      return 0
    fi
  done
}

ensure() {
  local name="$1" current="$2" secret="$3" value
  if [ -n "$current" ]; then return 0; fi
  value="$(from_zshrc "$name")"
  if [ -z "$value" ]; then value="$(from_bb_secret "$secret")"; fi
  if [ -n "$value" ]; then export "$name=$value"; fi
}

ensure OPENROUTER_API_KEY "${OPENROUTER_API_KEY:-}" openrouterApiKey
ensure OPENAI_API_KEY "${OPENAI_API_KEY:-}" openaiApiKey

exec node "$@"
