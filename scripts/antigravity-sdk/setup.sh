#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv="$here/.venv"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required: https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi

if [ ! -x "$venv/bin/python" ]; then
  uv venv "$venv" --python "${ANTIGRAVITY_SDK_PYTHON:-3.15}"
fi

uv pip install --python "$venv/bin/python" --upgrade google-antigravity

echo
echo "Antigravity SDK installed in $venv"
echo "Next: $here/run.sh hello.py --prompt 'Reply with exactly: PONG'"
