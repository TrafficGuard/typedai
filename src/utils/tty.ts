import fs from 'node:fs/promises';

/*
/dev/tty is Linux and macOS specific. On Windows:
Windows Subsystem for Linux (WSL): /dev/tty is available.
Pure Windows: You can use CON (e.g., \\.\CON via Win32 API in C++ or fs.writeFileSync('\\\\.\\CON', '...') in Node.js) in certain contexts, but this is not portable and significantly more complex.
*/
/**
 * Writes directly to the TTY. Linux and macO only. This is useful for writing to the terminal when you dont want to interfere with the stdout/stderr that might be passed/read from a calling or piped process.
 * @param text
 */
export async function writeToTty(text: string) {
	try {
		await fs.writeFile('/dev/tty', text);
	} catch (err) {
		console.error('Failed to write to /dev/tty:', err);
	}
}
