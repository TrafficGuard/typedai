import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path, { join } from 'path';
import { logger } from '#o11y/logger';
import { systemDir } from '../appVars';

export interface CliOptions {
	/** Name of the executed .ts file without the extension */
	scriptName: string;
	initialPrompt: string;
	resumeAgentId: string | undefined;
	/** Optional array of function class names to use */
	functionClasses?: string[];
}

export function parseProcessArgs(): CliOptions {
	logger.info(process.argv);
	const scriptPath = process.argv[1];
	let scriptName = scriptPath.split(path.sep).at(-1);
	scriptName = scriptName.substring(0, scriptName.length - 3);
	return parseUserCliArgs(scriptName, process.argv.slice(2));
}

/**
 * Parse function class names from -f=FunctionClass,... command line argument
 */
function parseFunctionArgument(args: string[]): string[] | undefined {
	console.log(args);
	const toolArg = args.find((arg) => arg.startsWith('-f='));
	logger.info(`Function arg: ${toolArg}`);
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

	let resumeLastRun = false;
	let i = 0;
	for (; i < scriptArgs.length; i++) {
		if (scriptArgs[i] === '-r') {
			resumeLastRun = true;
		} else {
			break;
		}
	}

	// Extract function classes before processing prompt
	const functionClasses = parseFunctionArgument(scriptArgs);
	// Remove the function argument from args if present
	const promptArgs = scriptArgs.filter((arg) => !arg.startsWith('-t=') && !arg.startsWith('-f='));
	let initialPrompt = promptArgs.slice(i).join(' ');

	logger.debug({ functionClasses }, 'Parsed function classes');
	// logger.info(initialPrompt);

	// If no prompt provided then load from file
	if (!initialPrompt.trim()) {
		if (existsSync(`src/cli/${scriptName}-in`)) initialPrompt = readFileSync(`src/cli/${scriptName}-in`, 'utf-8');
	}

	// logger.info(initialPrompt);

	const resumeAgentId = resumeLastRun ? getLastRunAgentId(scriptName) : undefined;

	return { scriptName, resumeAgentId, initialPrompt, functionClasses };
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
