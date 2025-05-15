#!/usr/bin/env node
// ^ Shebang line allows running directly like './build.js build' if executable

const { spawn } = require('child_process');
const path = require('path');

// --- Configuration ---
// Define the directories involved relative to where build.js is located
const ROOT_DIR_INFO = { name: 'root', path: '.' };
const FRONTEND_DIR_INFO = { name: 'frontend', path: './frontend' };
const DIRS_TO_OPERATE_ON = [ROOT_DIR_INFO, FRONTEND_DIR_INFO];

// List of common npm commands that DO NOT require 'run' prefix
const NPM_BUILTIN_COMMANDS = new Set([
    'install', 'i', 'ci', // Installation
    'uninstall', 'un', 'remove', 'rm', // Uninstallation
    'update', 'up', // Updating packages
    'publish', // Publishing
    'pack', // Packing
    'version', // Version management
    'init', // Project initialization
    'help', // Help
    'config', // Configuration
    'search', 's', // Searching packages
    'view', 'info', // Viewing package info
    'adduser', 'login', // User management
    'logout', // User management
    'whoami', // User management
    'ping', // Network check
    'doctor', // Environment check
    'audit', // Security auditing
    'outdated', // Checking for outdated packages
    // Add any other built-in commands you might use
]);


// --- Helper Function to Run Commands ---

/**
 * Executes a shell command in a specified directory.
 * Collects stdout and stderr. Handles complex commands using the system shell.
 *
 * @param {string} commandString - The command to execute (e.g., "npm run build", "npm install").
 * @param {string} cwd - The absolute path to the directory where the command should run.
 * @param {string} taskName - A descriptive name for the task (for logging).
 * @returns {Promise<{stdout: string, stderr: string, taskName: string}>} - Resolves with collected output and taskName on success.
 *                                                                        Rejects with { code: number | null, stdout: string, stderr: string, error?: Error, taskName: string } on failure.
 */
function runCommand(commandString, cwd, taskName) {
    return new Promise((resolve, reject) => {
        console.log(`--- [${taskName}] Starting in ${cwd}: "${commandString}" ---`);

        let stdout = '';
        let stderr = '';

        const isWindows = process.platform === 'win32';
        const shell = isWindows ? 'cmd' : '/bin/sh';
        const shellArgs = isWindows ? ['/c'] : ['-c'];
        shellArgs.push(commandString); // Add the actual command

        const childProcess = spawn(shell, shellArgs, {
            cwd: cwd,
            stdio: ['pipe', 'pipe', 'pipe'] // Capture stdio
        });

        childProcess.stdout.on('data', (data) => { stdout += data.toString(); });
        childProcess.stderr.on('data', (data) => { stderr += data.toString(); });

        childProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`--- [${taskName}] Finished successfully ---`);
                resolve({ stdout: trim(stdout), stderr:trim(stderr), taskName });
            } else {
                console.error(`--- [${taskName}] Failed with exit code ${code} ---`);
                reject({ code, stdout:trim(stdout), stderr:trim(stderr), taskName });
            }
        });

        childProcess.on('error', (err) => {
            console.error(`--- [${taskName}] Failed to start command ---`);
            console.error('Error:', err.message);
            if (err.code === 'ENOENT') {
                stderr += `\nError: Failed to start command. The working directory "${cwd}" might not exist or the shell command "${shell}" was not found.`;
            }
            reject({ code: null, stdout:trim(stdout), stderr:trim(stderr), error: err, taskName });
        });
    });
}

// --- Task Execution Logic ---

/**
 * Runs a specific npm script or command in multiple directories in parallel.
 * Automatically prepends 'run' if the command is not a known built-in npm command.
 *
 * @param {string} scriptOrCommandName - The base npm command or script name (e.g., 'install', 'build', 'lint').
 * @param {Array<{name: string, path: string}>} directories - Array of directory info objects.
 * @returns {Promise<boolean>} - Resolves with true if all commands succeeded, false otherwise.
 */
async function runNpmScriptOrCommandInDirs(scriptOrCommandName, directories) {
    if(scriptOrCommandName === 'lint' && directories.some(dirInfo => dirInfo.path === './frontend')) {
        console.log('skipping frontend lint')
        return true;
    }

    // Determine if 'run' is needed
    const needsRun = !NPM_BUILTIN_COMMANDS.has(scriptOrCommandName);
    const npmSubCommand = needsRun ? `run ${scriptOrCommandName}` : scriptOrCommandName;
    const fullBaseCommand = `npm ${npmSubCommand}`;

    console.log(`\n>>> Starting parallel execution of "${fullBaseCommand}" <<<`);

    const commandPromises = directories.map(dirInfo => {
        const resolvedPath = path.resolve(dirInfo.path);
        // Use the base script/command name for the task identifier for consistency
        const taskName = `${dirInfo.name}-${scriptOrCommandName}`; // e.g., "frontend-build", "root-install"

        if(dirInfo.path.includes('frontend') && scriptOrCommandName === 'test')
            scriptOrCommandName = 'test:ci'

        return runCommand(fullBaseCommand, resolvedPath, taskName);
    });

    const results = await Promise.allSettled(commandPromises);

    let anyFailed = false;
    console.log('\n--- Task Results ---');

    results.forEach(result => {
        if (result.status === 'fulfilled') {
            // Success logged by runCommand
        } else { // status === 'rejected'
            anyFailed = true;
            const error = result.reason;
            // Failure logged by runCommand, but log detailed output here
            console.error(`\n[${error.taskName}] FAILED.`);
            if (error.code !== null) console.error(`Exit Code: ${error.code}`);
            if (error.error) console.error(`Spawn Error: ${error.error.message}`);
            console.error(`--- [${error.taskName}] STDOUT ---`);
            console.error(error.stdout || '(No stdout captured)');
            console.error(`--- [${error.taskName}] STDERR ---`);
            console.error(error.stderr || '(No stderr captured)');
            console.error('--- End Failure Details ---');
        }
    });

    if (anyFailed) {
        console.error(`\n>>> "${fullBaseCommand}" failed in one or more directories. <<<`);
        return false; // Indicate failure
    } else {
        console.log(`\n>>> "${fullBaseCommand}" completed successfully in all directories. <<<`);
        return true; // Indicate success
    }
}

// --- Main Application Logic ---

async function main() {
    const args = process.argv.slice(2);
    const command = args[0]?.toLowerCase(); // Get the command (e.g., 'build', 'install') and lowercase it

    if (!command) {
        console.error("Usage: node build.js <command>");
        console.error("Expected commands based on common config: install, build, lint, test");
        process.exit(1);
    }

    console.log(`Executing command: ${command}`);
    let success = false;

    try {
        // We now treat all commands uniformly and let runNpmScriptOrCommandInDirs handle 'run'
        // You can map specific CLI args to different npm script names if needed,
        // but for install, build, lint, test, the mapping is direct.
        switch (command) {
            case 'install':
            case 'build':
            case 'lint':
            case 'test':
                // Add other commands from your config here if they follow the same pattern
                success = await runNpmScriptOrCommandInDirs(command, DIRS_TO_OPERATE_ON);
                break;

            // Example: If you had a 'format' command in config mapping to 'npm run prettier'
            // case 'format':
            //     success = await runNpmScriptOrCommandInDirs('prettier', DIRS_TO_OPERATE_ON);
            //     break;

            default:
                console.warn(`Warning: Command "${command}" is not explicitly handled in the switch statement.`);
                console.warn(`Attempting to run "npm ${NPM_BUILTIN_COMMANDS.has(command) ? command : `run ${command}`}" anyway...`);
                success = await runNpmScriptOrCommandInDirs(command, DIRS_TO_OPERATE_ON);
                // If you prefer to error out on unknown commands:
                // console.error(`Unknown command: ${command}`);
                // console.error("Expected commands: install, build, lint, test");
                // process.exit(1);
                break;
        }
    } catch (error) {
        console.error("\n--- An unexpected error occurred ---");
        console.error(error);
        process.exit(1);
    }

    if (!success) {
        console.error(`\nCommand "${command}" failed.`);
        process.exit(1);
    } else {
        console.log(`\nCommand "${command}" completed successfully.`);
        // process.exit(0); // Optional
    }
}

/**
 * Removes most ANSI escape codes (like colors, formatting) from a string,
 * but specifically converts OSC 8 hyperlinks into Markdown format `[Text](URL)`.
 *
 * @param text The input string potentially containing ANSI codes.
 * @returns The string with non-link ANSI codes removed and links formatted as Markdown,
 *          or the original string if input is null/undefined/empty.
 */
function trim(text){
    if (!text) return text ?? '';

    // Regular expression to specifically match OSC 8 hyperlinks.
    // It captures the URL (group 1) and the Link Text (group 2).
    // Format: \x1B]8;;URL\x1B\\Text\x1B]8;;\x1B\\
    // Using \x1B for ESC
    // biome-ignore lint/suspicious/noControlCharactersInRegex: expected
    const osc8Regex = /\x1B]8;;(.*?)\x1B\\(.*?)\x1B]8;;\x1B\\/g;

    // First pass: Replace OSC 8 links with Markdown format.
    // We use the captured groups: $2 is the text, $1 is the URL.
    let processedText = text.replace(osc8Regex, '[$2]($1)');

    // Regular expression to match *other* common ANSI escape codes
    // (like SGR for colors/styles: \x1B[...m, and other CSI sequences).
    // This regex is designed *not* to match the already-processed Markdown links.
    // It's the same comprehensive regex used before for stripping.
    const ansiStripRegex = new RegExp(
        [
            '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
            '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
        ].join('|'),
        'g',
    );

    // Second pass: Remove all remaining ANSI codes (colors, formatting, etc.)
    // from the string that now contains Markdown links.
    processedText = processedText.replace(ansiStripRegex, '');

    return processedText;
}


main().catch((e) => {
    console.error(e);
    process.exit(1);
});
