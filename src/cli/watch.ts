import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { WatchEventType } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { fileExistsSync } from 'tsconfig-paths/lib/filesystem';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { cerebrasQwen3_Coder } from '#llm/services/cerebras';
import { logger } from '#o11y/logger';
import { SearchReplaceCoder } from '#swe/coder/searchReplaceCoder';
import { MorphAPI } from '#swe/morph/morphApi';
import { MorphEditor } from '#swe/morph/morphEditor';
import { execCommand } from '#utils/exec';
import { parseProcessArgs } from './cli';

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
	initInMemoryApplicationContext();
	startWatcher();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);

export function extractInstructionBlock(fileContents: string): string | null {
	const match = fileContents.match(/@@@([\s\S]*?)@@/m);
	return match ? match[1].trim() : null;
}

/**
 * This starts a file watcher which looks for particularly formatted lines which contain prompts for the AI code editor
 */
export function startWatcher(): void {
	const opts = parseProcessArgs();
	const watchPath = String(opts.flags.fs) || process.cwd();

	const watcher = fs.watch(watchPath, { recursive: true }, async (event: WatchEventType, filename: string | null) => {
		console.log(event, filename);
		// Early exit if filename is null
		if (!filename) return;
		console.log(`${event} ${filename}`);

		const filePath = path.join(watchPath, filename);
		if (!fileExistsSync(filePath)) {
			logger.info(`${filePath} doesn't exist`);
			return;
		}
		console.log(`Checking ${filePath}`);
		try {
			// const repoRoot = findRepoRoot(filePath);
			const fileContents = await fs.promises.readFile(filePath, 'utf-8');

			const instructions = extractInstructionBlock(fileContents);
			if (!instructions) return;
			console.log(`Extracted instructions: ${instructions}`);

			let start = Date.now();
			const codeEdits = await generateCodeEdits(fileContents, instructions);
			const editsTime = Date.now() - start;
			start = Date.now();
			await new MorphEditor().editFile(filePath, instructions, codeEdits);
			const morphTime = Date.now() - start;
			console.log(`Edits: ${(editsTime / 1000).toFixed(1)}s, Morph: ${(morphTime / 1000).toFixed(1)}s`);
			// Pass the prompt to the AiderCodeEditor
			// logger.info('Running SearchReplaceCoder...');
			// // TODO should include all imported files as readonly
			// const result = await new SearchReplaceCoder(llms(), getFileSystem()).editFilesToMeetRequirements(prompt, [filePath], [], false);
			// logger.info(result);
			// Exit early after handling the first valid line
			return;
		} catch (error) {
			console.error(`Error reading file ${filePath}:`, error);
		}
	});

	console.log(`Started watcher for ${watchPath}`);
}

async function generateCodeEdits(fileContents: string, instructions: string): Promise<string> {
	// Locate the @@@ ... @@ instruction block to build a deterministic deletion snippet
	const lines = fileContents.split('\n');
	let startLineIdx = -1;
	let endLineIdx = -1;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes('@@@')) {
			startLineIdx = i;
			break;
		}
	}
	if (startLineIdx !== -1) {
		for (let j = startLineIdx; j < lines.length; j++) {
			if (lines[j].includes('@@') && (j !== startLineIdx || lines[j].indexOf('@@') > lines[j].indexOf('@@@'))) {
				endLineIdx = j;
				break;
			}
		}
	}

	const before = startLineIdx > 0 ? lines[startLineIdx - 1] : null;
	const after = endLineIdx >= 0 && endLineIdx < lines.length - 1 ? lines[endLineIdx + 1] : null;

	const buildDeletionSnippet = (): string => {
		if (startLineIdx === -1 || endLineIdx === -1) return '';
		if (before && after) {
			return `// ... existing code ...\n${before}\n${after}\n// ... existing code ...`;
		}
		if (before) {
			return `// ... existing code ...\n${before}\n// ... existing code ...`;
		}
		if (after) {
			return `// ... existing code ...\n${after}\n// ... existing code ...`;
		}
		return '';
	};

	const deletionSnippet = buildDeletionSnippet();

	const prompt = [
		'You are a code editing engine that produces edit snippets for MorphEditor.',
		'Output rules:',
		'- Return ONLY the edit snippet. No prose, no headings, no markdown fences.',
		'- Use exactly this sentinel to elide unchanged code: // ... existing code ...',
		'- Provide minimal but sufficient unchanged context (1–3 lines) around each modification.',
		'- You may include multiple non-contiguous edits; separate them with the sentinel.',
		'- Do NOT output the entire file.',
		'- Remove the entire instruction block delimited by @@@ and @@ (including those marker lines).',
		'',
		'Apply these instructions to the file:',
		instructions,
		'',
		'Current file contents (read-only):',
		'<<FILE>>',
		fileContents,
		'<<END FILE>>',
		'',
		'Return only the edit snippet.',
	].join('\n');

	let edits = await cerebrasQwen3_Coder().generateText(prompt, { temperature: 0.1, topP: 0, id: 'morph-edit' });

	// Strip code fences if the model accidentally added them
	const fenced = edits.match(/```(?:\w+)?\n([\s\S]*?)```/);
	edits = (fenced ? fenced[1] : edits).trim();

	// Append a deterministic deletion snippet to ensure the @@@ ... @@ block is removed
	if (deletionSnippet) {
		// Skip appending if the edit already implies the deletion (basic heuristic)
		const alreadyCoversDeletion = before && after ? edits.includes(`${before}\n${after}`) : false;
		if (!alreadyCoversDeletion) {
			edits = edits ? `${edits}\n${deletionSnippet}` : deletionSnippet;
		}
	}

	return edits;
}
