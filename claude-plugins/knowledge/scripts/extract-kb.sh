#!/bin/bash
set -e

# Read hook input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

TIMESTAMP=$(date '+%Y-%m-%d--%H-%M')
KB_DIR="$CLAUDE_PROJECT_DIR/kb"
mkdir -p "$KB_DIR"

# Fork the session and generate knowledge in the background
# Forking uses context caching for efficiency
# Pass empty settings to disable any user/project hooks which might interfere
nohup claude -p --resume "$SESSION_ID" --fork-session --print --settings '{}' \
  "Carefully ultrathink reviewing in detail every message from the start of the conversation, taking notes on what was learnt along the way, such as the application design/features, like the file system paths, why I made certain decisions, and fixed incorrect code/decisions. We want to capture knowledge that can be provided to other developers and AI agents, both specific to the applications and general principles. Do not include details that are only specific to a single file (there might not be any project level knowledge), this is about capturing project level conventions, patterns, designs. Generate a report with the knowledge" \
  > "$KB_DIR/${TIMESTAMP}.md" 2>&1 &

echo "Knowledge base extraction started in background (forked from session $SESSION_ID)"
