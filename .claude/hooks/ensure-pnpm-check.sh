#!/bin/bash
# Stop hook that ensures pnpm check has been run since the last stop
#
# Exit codes:
#   0 - Allow stopping (stdout/stderr not shown)
#   2 - Block stopping (stderr shown to model)

# Read hook input from stdin (read returns 1 on EOF, so use || true)
input=""
read -r input || true

# If no input, allow stopping
if [ -z "$input" ]; then
  exit 0
fi

# Prevent infinite loops - if we already blocked once, allow stopping
if echo "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Extract transcript path from input and expand tilde
transcript_path=$(echo "$input" | python3 -c "
import sys, json, os
path = json.load(sys.stdin).get('transcript_path', '')
print(os.path.expanduser(path))
" 2>/dev/null || echo "")

if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
  exit 0
fi

# Find the line number of the last stop event, then check if pnpm check was EXECUTED after it
python3 - "$transcript_path" << 'PYTHON'
import sys
import json
import re

transcript_path = sys.argv[1]
last_stop_line = 0
last_check_line = 0

# Pattern to match "pnpm check" as the actual command (not just mentioned in a grep/echo)
# Must start with pnpm check, optionally with env vars before it
pnpm_check_pattern = re.compile(r'^(\w+=\w+\s+)*pnpm\s+check(\s|$)')

with open(transcript_path, 'r') as f:
    for i, line in enumerate(f, 1):
        try:
            entry = json.loads(line)
        except:
            continue

        # Look for stop events
        if entry.get('type') == 'result' and entry.get('subtype') == 'stop':
            last_stop_line = i

        # Look for pnpm check being EXECUTED (in a Bash tool_use)
        msg = entry.get('message', {})
        content = msg.get('content', [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get('type') == 'tool_use':
                    if block.get('name') == 'Bash':
                        cmd = block.get('input', {}).get('command', '').strip()
                        # Check if command IS "pnpm check" (not just contains it)
                        if pnpm_check_pattern.match(cmd):
                            last_check_line = i

# pnpm check must have been run after the last stop (or no stops yet)
if last_check_line > last_stop_line:
    sys.exit(0)  # Allow stopping
else:
    # Exit code 2 + stderr = block stopping and show message to model
    print("pnpm check has not been run since the last stop. Please run `pnpm check` to compile, lint and run tests before stopping.", file=sys.stderr)
    sys.exit(2)
PYTHON
