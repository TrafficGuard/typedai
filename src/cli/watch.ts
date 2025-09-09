import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { WatchEventType } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { fileExistsSync } from 'tsconfig-paths/lib/filesystem';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { SearchReplaceCoder } from '#swe/coder/searchReplaceCoder';
import { execCommand } from '#utils/exec';

/**
 * Walks up the directory tree from the file location until a `.git` folder is found.
 * Falls back to the file's directory when no repository root is detected.
 */
function findRepoRoot(startFilePath: string): string {
	let dir = path.dirname(startFilePath);
	while (dir !== path.parse(dir).root) {
		if (fs.existsSync(path.join(dir, '.git'))) return dir;
		dir = path.dirname(dir);
	}
	return path.dirname(startFilePath);
}

async function main() {
	startWatcher();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);

/**
 * This starts a file watcher which looks for particularly formatted lines which contain prompts for the AI code editor
 */
export function startWatcher(): void {
	const watchPath = 'src';
	const watcher = fs.watch(watchPath, { recursive: true }, async (event: WatchEventType, filename: string | null) => {
		// Early exit if filename is null
		if (!filename) return;
		console.log(`${event} ${filename}`);

		const filePath = path.join(process.cwd(), watchPath, filename);
		if (!fileExistsSync(filePath)) {
			logger.debug(`${filePath} doesn't exist`);
			return;
		}
		console.log(`Checking ${filePath}`);
		try {
			const data = await fs.promises.readFile(filePath, 'utf-8');

			// Check for the presence of "AI-STATUS"
			if (data.includes('AI-STATUS')) {
				logger.info('AI-STATUS found');
				return;
			}

			// -----------------------------------------------------------------
			// New behaviour: look for @@ai … @@ blocks (can span multiple lines)
			// -----------------------------------------------------------------
			const aiCmdMatch = data.match(/@@ai([\\s\\S]*?)@@/m);
			if (aiCmdMatch) {
				const cmd = aiCmdMatch[1].trim();
				const repoRoot = findRepoRoot(filePath);
				logger.info(`Executing AI command ("${cmd}") in ${repoRoot}`);

				try {
					const { stdout, stderr } = await execCommand(cmd, { workingDirectory: repoRoot, throwOnError: true });
					if (stdout) logger.info(stdout);
					if (stderr) logger.warn(stderr);
				} catch (e) {
					logger.error(e, `Command "${cmd}" failed`);
				}
				return; // Do not continue with //>> watcher flow
			}

			const lines = data.split('\n');

			// Find the index of the first line that starts with '//>>' and ends with '//'
			const index = lines.findIndex((line) => line.includes('//>') && line.trim().endsWith('//'));

			// Early exit if no matching lines are found
			if (index === -1) return;

			// If a matching line is found, proceed to extract requirements
			const line = lines[index];
			const indentation = line.match(/^\s*/)?.[0]; // Capture leading whitespace for indentation
			const requirements = line.trim().slice(3, -2).trim();

			logger.info(`Extracted requirements: ${requirements}`);

			// Formulate the prompt
			const prompt = `You are to implement the TODO instructions on the line which starts with //>> and ends with //.\ni.e: ${requirements}`;

			// Insert "// AI-STATUS - working" after the instruction line with the same indentation
			lines.splice(index + 1, 0, `${indentation}// AI-STATUS - working`);

			// Write the modified lines back to the file
			await fs.promises.writeFile(filePath, lines.join('\n'), 'utf-8');

			// Pass the prompt to the AiderCodeEditor
			logger.info('Running SearchReplaceCoder...');
			// TODO should include all imported files as readonly
			const result = await new SearchReplaceCoder(llms(), getFileSystem()).editFilesToMeetRequirements(prompt, [filePath], [], false);
			logger.info(result);
			// Exit early after handling the first valid line
			return;
		} catch (error) {
			console.error(`Error reading file ${filePath}:`, error);
		}
	});

	console.log('Started watcher');
}
