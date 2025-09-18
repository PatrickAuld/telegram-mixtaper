#!/usr/bin/env bash
set -euo pipefail

OUT_DIR=${1:-dist}
NAME=${2:-telegram-mixtaper}

uv sync --locked --dev
uv run --locked --no-sync pyinstaller bot.py \
  --name "${NAME}" \
  --onefile \
  --distpath "${OUT_DIR}" \
  --clean
