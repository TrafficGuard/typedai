#!/usr/bin/env node
/**
 * Stop hook that ensures the check command has been run since the last stop
 * (only if files have changed)
 *
 * Exit codes:
 *   0 - Allow stopping (stdout/stderr not shown)
 *   2 - Block stopping (stderr shown to model)
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

// --- Configuration ---
const CHECK_COMMAND = 'pnpm check';

// Pattern to match the check command (not just mentioned in a grep/echo)
// Must start with the command, optionally with env vars before it
const CHECK_COMMAND_PATTERN = new RegExp(
  `^(\\w+=\\w+\\s+)*${CHECK_COMMAND.replace(/\s+/g, '\\s+')}(\\s|$)`
);

// --- Git state tracking ---

function getGitRoot(cwd) {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

function getGitState(gitRoot) {
  try {
    const opts = { cwd: gitRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] };

    // Branch (handles detached HEAD)
    const branch = execSync(
      'git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD',
      { ...opts, shell: true }
    ).trim();

    // Current commit
    const commit = execSync('git rev-parse HEAD', opts).trim();

    // Hash of ALL outstanding changes (staged, unstaged, untracked)
    const changesHash = execSync(`
      (
        git diff --cached
        git diff
        git ls-files --others --exclude-standard -z | xargs -0 -r cat 2>/dev/null
        git status --porcelain
      ) | sha256sum | cut -d' ' -f1
    `, { ...opts, shell: '/bin/bash' }).trim();

    return `${branch}:${commit}:${changesHash}`;
  } catch {
    return null;
  }
}

function getStateFilePath(gitRoot) {
  // Store in .git directory so it's automatically ignored
  return join(gitRoot, '.git', 'claude-stop-state');
}

function getLastState(gitRoot) {
  try {
    return readFileSync(getStateFilePath(gitRoot), 'utf-8').trim();
  } catch {
    return null;
  }
}

function saveState(gitRoot, state) {
  try {
    writeFileSync(getStateFilePath(gitRoot), state);
  } catch {
    // Ignore write errors
  }
}

// --- Original hook logic ---

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const rl = createInterface({ input: process.stdin });
    rl.on('line', (line) => { data += line; });
    rl.on('close', () => resolve(data));
    setTimeout(() => { rl.close(); resolve(data); }, 100);
  });
}

function expandPath(path) {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

async function main() {
  const input = await readStdin();

  if (!input.trim()) {
    process.exit(0);
  }

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // Prevent infinite loops
  if (parsed.stop_hook_active === true) {
    process.exit(0);
  }

  // --- Check git state first ---
  const cwd = parsed.cwd || process.cwd();
  const gitRoot = getGitRoot(cwd);

  if (!gitRoot) {
    // Not a git repo, allow stopping
    process.exit(0);
  }

  const currentState = getGitState(gitRoot);
  const lastState = getLastState(gitRoot);

  // If states are identical, no changes since last stop - allow stopping
  if (currentState && lastState && currentState === lastState) {
    process.exit(0);
  }

  // --- States differ or first run - check transcript for check command ---
  const transcriptPath = expandPath(parsed.transcript_path || '');
  if (!transcriptPath) {
    // Can't verify, save state and allow
    if (currentState) saveState(gitRoot, currentState);
    process.exit(0);
  }

  let transcriptContent;
  try {
    transcriptContent = readFileSync(transcriptPath, 'utf-8');
  } catch {
    if (currentState) saveState(gitRoot, currentState);
    process.exit(0);
  }

  const lines = transcriptContent.split('\n').filter(Boolean);
  let lastStopLine = 0;
  let lastCheckLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    if (entry.type === 'result' && entry.subtype === 'stop') {
      lastStopLine = lineNum;
    }

    const msg = entry.message;
    const content = msg?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_use' && block.name === 'Bash') {
          const cmd = (block.input?.command || '').trim();
          if (CHECK_COMMAND_PATTERN.test(cmd)) {
            lastCheckLine = lineNum;
          }
        }
      }
    }
  }

  // Check command must have been run after the last stop
  if (lastCheckLine > lastStopLine) {
    // Save new state and allow stopping
    if (currentState) saveState(gitRoot, currentState);
    process.exit(0);
  }

  console.error(`Files have changed since last stop and \`${CHECK_COMMAND}\` has not been run. Please run \`${CHECK_COMMAND}\` before stopping.`);
  process.exit(2);
}

main();