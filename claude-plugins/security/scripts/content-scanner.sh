#!/bin/bash
# Content security scanner hook
#
# Tries Node.js first, falls back to Python
# Node.js supports: Model Armor, Ollama
# Python supports: Model Armor, Ollama, MLX (Apple Silicon)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read hook input from stdin
input=""
read -r input || true

# Use Node.js if available, otherwise fall back to Python
if command -v node &> /dev/null; then
  echo "$input" | node "$SCRIPT_DIR/content-scanner.mjs"
elif command -v python3 &> /dev/null; then
  echo "$input" | python3 "$SCRIPT_DIR/content-scanner.py"
else
  # No runtime available, allow request
  exit 0
fi
