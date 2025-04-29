import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { WatchEventType } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { fileExistsSync } from 'tsconfig-paths/lib/filesystem';
import { logger } from '#o11y/logger';
import { AiderCodeEditor } from '#swe/aiderCodeEditor';

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
export function startWatcher() {
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

			const lines = data.split('\n');

			// Find the index of the first line that starts with '//>>' and ends with '//'
			const index = lines.findIndex((line) => line.includes('//>') && line.trim().endsWith('//'));

			// Early exit if no matching lines are found
			if (index === -1) return;

			// If a matching line is found, proceed to extract requirements
			const line = lines[index];
			const indentation = line.match(/^\s*/)[0]; // Capture leading whitespace for indentation
			const requirements = line.trim().slice(3, -2).trim();

			logger.info(`Extracted requirements: ${requirements}`);

			// Formulate the prompt
			const prompt = `You are to implement the TODO instructions on the line which starts with //>> and ends with //.\ni.e: ${requirements}`;

			// Insert "// AI-STATUS - working" after the instruction line with the same indentation
			lines.splice(index + 1, 0, `${indentation}// AI-STATUS - working`);

			// Write the modified lines back to the file
			await fs.promises.writeFile(filePath, lines.join('\n'), 'utf-8');

			// Pass the prompt to the AiderCodeEditor
			logger.info('Running Aider...');
			const result = await new AiderCodeEditor().editFilesToMeetRequirements(prompt, [filePath], false);
			logger.info(result);
			// Exit early after handling the first valid line
			return;
		} catch (error) {
			console.error(`Error reading file ${filePath}:`, error);
		}
	});

	console.log('Started watcher');
}
