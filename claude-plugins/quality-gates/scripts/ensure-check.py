#!/usr/bin/env python3
"""
Stop hook that ensures the check command has been run since the last stop
(only if files have changed)

Reads the check command from .typedai.json in the current directory or git root.

Exit codes:
  0 - Allow stopping (stdout/stderr not shown)
  2 - Block stopping (stderr shown to model)
"""

import sys
import json
import re
import os
import subprocess

# --- Configuration from .typedai.json ---

def find_typedai_config(cwd, git_root):
    """Find .typedai.json in cwd or git root."""
    # Try cwd first
    cwd_path = os.path.join(cwd, '.typedai.json')
    if os.path.isfile(cwd_path):
        return cwd_path

    # Try git root if different
    if git_root and git_root != cwd:
        root_path = os.path.join(git_root, '.typedai.json')
        if os.path.isfile(root_path):
            return root_path

    return None


def get_check_command(config_path):
    """Extract the check command from .typedai.json."""
    try:
        with open(config_path, 'r') as f:
            content = json.load(f)

        if not isinstance(content, list):
            return None

        # Find primary project or use first
        project = next((p for p in content if p.get('primary')), None) or (content[0] if content else None)
        return project.get('check') if project else None
    except:
        return None


# --- Git state tracking ---

def get_git_root(cwd):
    """Get the root of the git repository, or None if not in a repo."""
    try:
        result = subprocess.run(
            ['git', 'rev-parse', '--show-toplevel'],
            cwd=cwd,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return None
    except:
        return None


def get_git_state(git_root):
    """Get a fingerprint of the current git state (branch, commit, changes)."""
    try:
        def run_git(cmd, shell=False):
            result = subprocess.run(
                cmd,
                cwd=git_root,
                capture_output=True,
                text=True,
                shell=shell
            )
            return result.stdout.strip() if result.returncode == 0 else None

        # Branch (handles detached HEAD)
        branch = run_git(['git', 'symbolic-ref', '--short', 'HEAD'])
        if not branch:
            branch = run_git(['git', 'rev-parse', '--short', 'HEAD'])

        # Current commit
        commit = run_git(['git', 'rev-parse', 'HEAD'])

        # Hash of ALL outstanding changes (staged, unstaged, untracked)
        changes_hash = run_git(
            '''(
                git diff --cached
                git diff
                git ls-files --others --exclude-standard -z | xargs -0 -r cat 2>/dev/null
                git status --porcelain
            ) | sha256sum | cut -d' ' -f1''',
            shell=True
        )

        if branch and commit and changes_hash:
            return f"{branch}:{commit}:{changes_hash}"
        return None
    except:
        return None


def get_state_file_path(git_root):
    """Get the path to store the state file (in .git directory)."""
    return os.path.join(git_root, '.git', 'claude-stop-state')


def get_last_state(git_root):
    """Read the last saved git state."""
    try:
        with open(get_state_file_path(git_root), 'r') as f:
            return f.read().strip()
    except:
        return None


def save_state(git_root, state):
    """Save the current git state."""
    try:
        with open(get_state_file_path(git_root), 'w') as f:
            f.write(state)
    except:
        pass  # Ignore write errors


# --- Main hook logic ---

def main():
    # Read input from stdin
    try:
        input_data = sys.stdin.read().strip()
    except:
        sys.exit(0)

    if not input_data:
        sys.exit(0)

    try:
        parsed = json.loads(input_data)
    except:
        sys.exit(0)

    # Prevent infinite loops - if we already blocked once, allow stopping
    if parsed.get('stop_hook_active') is True:
        sys.exit(0)

    # --- Check git state first ---
    cwd = parsed.get('cwd', os.getcwd())
    git_root = get_git_root(cwd)

    if not git_root:
        # Not a git repo, allow stopping
        sys.exit(0)

    # --- Find check command from .typedai.json ---
    config_path = find_typedai_config(cwd, git_root)
    if not config_path:
        # No config file, allow stopping
        sys.exit(0)

    check_command = get_check_command(config_path)
    if not check_command:
        # No check command configured, allow stopping
        sys.exit(0)

    # Build pattern to match the check command (not just mentioned in grep/echo)
    # Must start with the command, optionally with env vars before it
    CHECK_COMMAND_PATTERN = re.compile(
        r'^(\w+=\w+\s+)*' + check_command.replace(' ', r'\s+') + r'(\s|$)'
    )

    current_state = get_git_state(git_root)
    last_state = get_last_state(git_root)

    # If states are identical, no changes since last stop - allow stopping
    if current_state and last_state and current_state == last_state:
        sys.exit(0)

    # --- States differ or first run - check transcript for check command ---
    transcript_path = parsed.get('transcript_path', '')
    if transcript_path.startswith('~'):
        transcript_path = os.path.expanduser(transcript_path)

    if not transcript_path or not os.path.isfile(transcript_path):
        # Can't verify, save state and allow
        if current_state:
            save_state(git_root, current_state)
        sys.exit(0)

    last_stop_line = 0
    last_check_line = 0

    with open(transcript_path, 'r') as f:
        for i, line in enumerate(f, 1):
            try:
                entry = json.loads(line)
            except:
                continue

            # Look for stop events
            if entry.get('type') == 'result' and entry.get('subtype') == 'stop':
                last_stop_line = i

            # Look for check command being EXECUTED (in a Bash tool_use)
            msg = entry.get('message', {})
            content = msg.get('content', [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get('type') == 'tool_use':
                        if block.get('name') == 'Bash':
                            cmd = block.get('input', {}).get('command', '').strip()
                            if CHECK_COMMAND_PATTERN.match(cmd):
                                last_check_line = i

    # Check command must have been run after the last stop
    if last_check_line > last_stop_line:
        # Save new state and allow stopping
        if current_state:
            save_state(git_root, current_state)
        sys.exit(0)

    print(
        f"Files have changed since last stop and `{check_command}` has not been run. "
        f"Please run `{check_command}` before stopping.",
        file=sys.stderr
    )
    sys.exit(2)


if __name__ == '__main__':
    main()
