#!/usr/bin/env bash
set -euo pipefail

uv sync --locked --dev
uv run --locked --no-sync python -m compileall bot.py oauth2.py
