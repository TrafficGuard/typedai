#!/bin/bash
# Stop hook that ensures the check command has been run since the last stop
#
# Exit codes:
#   0 - Allow stopping (stdout/stderr not shown)
#   2 - Block stopping (stderr shown to model)
#
# Tries Node.js first, falls back to Python

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read hook input from stdin
input=""
read -r input || true

# Use Node.js if available, otherwise fall back to Python
if command -v node &> /dev/null; then
  echo "$input" | node "$SCRIPT_DIR/ensure-check.mjs"
elif command -v python3 &> /dev/null; then
  echo "$input" | python3 "$SCRIPT_DIR/ensure-check.py"
else
  # No runtime available, allow stopping
  exit 0
fi
