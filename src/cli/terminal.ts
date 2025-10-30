// file: write-terminal.mjs
import { createWriteStream } from 'node:fs';
import { platform } from 'node:process';

/**
 * Writes a message directly to the controlling terminal, bypassing stdout/stderr redirection.
 * This is useful for progress indicators, password prompts, or critical alerts
 * that should always be visible to the user, even if they pipe the script's output to a file.
 *
 * @param {string} message The message to write to the terminal.
 */
export function terminalLog(message: string): void {
	// Determine the correct path to the terminal device based on the OS.
	const terminalPath = platform === 'win32' ? '\\\\.\\CON' : '/dev/tty';

	try {
		// Create a writable stream to the terminal device.
		// This will fail if the process is not running in an interactive terminal
		// (e.g., in a CI/CD pipeline, a cron job, or a non-interactive SSH session).
		const terminalStream = createWriteStream(terminalPath, {
			flags: 'a', // 'a' for append mode is safest
		});

		// Handle errors on the stream to prevent unhandled error events
		terminalStream.on('error', (error) => {
			// Silently fall back to console.error if terminal is not available
			console.error(message);
		});

		terminalStream.write(`${message}\n`);
		terminalStream.end(); // Close the stream to release the file handle.
	} catch (error) {
		// If we can't write to the terminal (e.g., not in a TTY),
		// we can fall back to stderr as a last resort for visibility.
		console.error(message);
	}
}
