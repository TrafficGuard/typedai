import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { systemDir } from '#app/appVars';
import { logger } from '#o11y/logger';

// Define a custom error type
export class CliArgumentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CliArgumentError';
	}
}
export interface CliOptions {
	/** Name of the executed .ts file without the extension */
	scriptName: string;
	initialPrompt: string;
	resumeAgentId: string | undefined;
	/** Optional array of function class names to use */
	functionClasses?: string[];
	useSharedRepos?: boolean;
}

export function parseProcessArgs(): CliOptions {
	const scriptPath = process.argv[1];
	let scriptName = scriptPath.split(path.sep).at(-1);
	scriptName = scriptName.substring(0, scriptName.length - 3);
	console.log(`Script name: ${scriptName}`);
	return parseUserCliArgs(scriptName, process.argv.slice(2)); // slice shallow copies as we may want to modify the slice later
}

/**
 * Parse function class names from -f=FunctionClass,... command line argument
 */
function parseFunctionArgument(args: string[]): string[] | undefined {
	console.log(args);
	const toolArg = args.find((arg) => arg.startsWith('-f=') || arg.startsWith('-t='));
	// logger.info(`Function arg: ${toolArg}`);
	if (!toolArg) return undefined;
	return toolArg
		.substring(3)
		.split(',')
		.map((s) => s.trim());
}

export function parseUserCliArgs(scriptName: string, scriptArgs: string[]): CliOptions {
	// strip out filesystem arg if it exists
	const fsArgIndex = scriptArgs.findIndex((arg) => arg.startsWith('--fs='));
	if (fsArgIndex > -1) {
		scriptArgs.splice(fsArgIndex, 1);
	}

	// Check if we're resuming an agent
	let resumeAgentId: string;
	let resumeLastRun = false;
	let i = 0;
	for (; i < scriptArgs.length; i++) {
		if (scriptArgs[i].startsWith('-r')) {
			resumeLastRun = true;
			if (scriptArgs[i].length > 3) resumeAgentId = scriptArgs[i].substring(3);
		} else {
			break;
		}
	}
	resumeAgentId = resumeLastRun ? resumeAgentId || getLastRunAgentId(scriptName) : undefined;
	if (resumeLastRun && !resumeAgentId) {
		// Throw error instead of exiting
		throw new CliArgumentError('No agentId to resume');
	}
	if (resumeAgentId) {
		// Log only if we are actually resuming
		logger.info(`Resuming agent ${resumeAgentId}`);
	}

	let useSharedRepos = true;
	const privateRepoArgIndex = scriptArgs.findIndex((arg) => arg === '--private' || arg === '-p');
	if (privateRepoArgIndex > -1) {
		useSharedRepos = false;
		scriptArgs.splice(privateRepoArgIndex, 1); // Remove the flag after processing
	}

	// Extract function classes before processing prompt
	const functionClasses = parseFunctionArgument(scriptArgs);
	// Remove the function argument from args if present
	const promptArgs = scriptArgs.filter((arg) => !arg.startsWith('-t=') && !arg.startsWith('-f='));
	let initialPrompt = promptArgs.slice(i).join(' ');

	if (initialPrompt.startsWith('-f') || initialPrompt.startsWith('-t') || initialPrompt.startsWith('--fs') || initialPrompt.startsWith('-r'))
		throw new Error(
			'If running from the npm command then program argument need to be seperated by "--". e.g. "npm run agent -- -f=code,web,jira". Alternatively use the "ai" script as an alias for "npm run" which doesnt required this, and can be run from any directory.',
		);

	logger.debug({ functionClasses }, 'Parsed function classes');
	// logger.info(initialPrompt);

	// If no prompt provided then load from file
	if (!initialPrompt.trim()) {
		if (existsSync(`src/cli/${scriptName}-in`)) initialPrompt = readFileSync(`src/cli/${scriptName}-in`, 'utf-8');
	}

	// logger.info(initialPrompt);

	return { scriptName, resumeAgentId, initialPrompt, functionClasses, useSharedRepos };
}

export function saveAgentId(scriptName: string, agentId: string): void {
	const dirPath = join(systemDir(), 'cli');
	mkdirSync(dirPath, { recursive: true });
	writeFileSync(join(dirPath, `${scriptName}.lastRun`), agentId);
}

export function getLastRunAgentId(scriptName: string): string | undefined {
	const filePath = join(systemDir(), 'cli', `${scriptName}.lastRun`);
	if (existsSync(filePath)) {
		return readFileSync(filePath, 'utf-8').trim();
	}
	logger.warn(`No agent to resume for ${scriptName} script`);
	return undefined;
}
