import { existsSync, fstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { systemDir } from '#app/appDirs';
import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { MAD_Balanced, MAD_Fast, MAD_SOTA } from '#llm/multi-agent/reasoning-debate';
import { Claude4_Opus_Vertex } from '#llm/services/anthropic-vertex';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { openAIo3 } from '#llm/services/openai';
import { perplexityDeepResearchLLM, perplexityLLM, perplexityReasoningProLLM } from '#llm/services/perplexity-llm';
import { logger } from '#o11y/logger';
import { LLM } from '#shared/llm/llm.model';

export const LLM_CLI_ALIAS: Record<string, () => LLM> = {
	e: () => defaultLLMs().easy,
	m: () => defaultLLMs().medium,
	h: () => defaultLLMs().hard,
	xh: () => defaultLLMs().xhard,
	fm: () => new FastMediumLLM(),
	o3: openAIo3,
	madb: MAD_Balanced,
	mads: MAD_SOTA,
	madf: MAD_Fast,
	opus: Claude4_Opus_Vertex,
	pp1: perplexityLLM,
	pp2: perplexityReasoningProLLM,
	pp3: perplexityDeepResearchLLM,
};

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
	/** Array of function class names to use */
	functionClasses: string[];
	useSharedRepos?: boolean;
	/** LLM selector supplied with -l or --llm */
	llmId?: string;
	/** Map of every CLI flag and its value (boolean true when no value) */
	flags: Record<string, string | boolean>;
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
function parseFunctionArgument(args: string[]): string[] {
	const toolArg = args.find((arg) => arg.startsWith('-f=') || arg.startsWith('-t='));
	// logger.info(`Function arg: ${toolArg}`);
	if (!toolArg) return [];
	return toolArg
		.substring(3)
		.split(',')
		.map((s) => s.trim());
}

export function parseUserCliArgs(scriptName: string, scriptArgs: string[]): CliOptions {
	// Keep an untouched copy for generic flag parsing
	const originalArgs = [...scriptArgs];

	/** Collect all dash-prefixed args into a { flag: value } map */
	const flags: Record<string, string | boolean> = {};
	for (let i = 0; i < originalArgs.length; i++) {
		const tok = originalArgs[i];
		if (!tok.startsWith('-')) continue;

		let key = '';
		let val: string | boolean = true;

		// long form  --foo or --foo=bar
		if (tok.startsWith('--')) {
			const body = tok.slice(2);
			if (body.includes('=')) {
				const [k, v] = body.split('=');
				key = k;
				val = v;
			} else {
				key = body;
				if (originalArgs[i + 1] && !originalArgs[i + 1].startsWith('-') && !originalArgs[i + 1].startsWith('--')) {
					val = originalArgs[i + 1];
				}
			}
		}
		// short form  -f  -f=bar  -f bar
		else {
			const body = tok.slice(1);
			if (body.includes('=')) {
				const [k, v] = body.split('=');
				key = k;
				val = v;
			} else {
				key = body;
				if (originalArgs[i + 1] && !originalArgs[i + 1].startsWith('-') && !originalArgs[i + 1].startsWith('--')) {
					val = originalArgs[i + 1];
				}
			}
		}
		flags[key] = val;
	}

	// strip out filesystem arg if it exists
	const fsArgIndex = scriptArgs.findIndex((arg) => arg.startsWith('--fs='));
	if (fsArgIndex > -1) {
		scriptArgs.splice(fsArgIndex, 1);
	}

	// Detect and read any prompt text piped or redirected into stdin.
	// This uses fstatSync so it works even when the script is launched through `npm run …`
	let pipedPrompt = '';
	try {
		// Do not read from stdin during tests, as it may be polluted by test runners or git hooks.
		if (process.env.NODE_ENV !== 'test') {
			const stats = fstatSync(0); // fd 0 = stdin
			// Is data coming from a pipe (FIFO) or a redirected file?
			if (stats.isFIFO() || stats.isFile()) {
				pipedPrompt = readFileSync(0, 'utf-8').trim();
			}
			// When stdin is a TTY (interactive), leave pipedPrompt = ''
		}
	} catch {
		/* ignore – fall back to CLI args or file */
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
	if (resumeLastRun) flags.r = resumeAgentId ?? true; // Record the -r flag in the flags map
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

	// --- LLM selector --------------------------------------------
	// The llmId value is now parsed into the 'flags' map.
	// We still need to remove the model arguments from scriptArgs to prevent them from becoming part of the prompt.
	const mIdx = scriptArgs.findIndex((a) => a === '-l' || a.startsWith('-l=') || a.startsWith('--llm='));
	if (mIdx > -1) {
		const token = scriptArgs[mIdx];
		if (token === '-l') {
			// If it's '-l value', remove the value part too
			if (scriptArgs[mIdx + 1] && !scriptArgs[mIdx + 1].startsWith('-')) {
				scriptArgs.splice(mIdx + 1, 1);
			}
		}
		scriptArgs.splice(mIdx, 1); // Remove the flag itself
	}
	const llmId: string | undefined = (flags.l as string) || (flags.llm as string); // Assign llm from the flags map

	// Extract function classes before processing prompt
	const functionClasses = parseFunctionArgument(scriptArgs);
	// Remove the function argument from args if present
	const promptArgs = scriptArgs.filter((arg) => !arg.startsWith('-t=') && !arg.startsWith('-f='));
	const argsPrompt = promptArgs.slice(i).join(' ').trim();
	let initialPrompt = '';

	// Precedence:
	//   1) piped input (if any) + append CLI args (if any)
	//   2) CLI args only
	//   3) fallback file
	if (pipedPrompt) {
		initialPrompt = argsPrompt ? `${pipedPrompt}\n\n${argsPrompt}` : pipedPrompt;
	} else {
		initialPrompt = argsPrompt;
	}

	if (!pipedPrompt && (initialPrompt.startsWith('-f') || initialPrompt.startsWith('-t') || initialPrompt.startsWith('--fs') || initialPrompt.startsWith('-r')))
		throw new Error(
			'If running a `npm run` command, the program arguments need to be seperated by "--". e.g. "npm run agent -- -f=code,web,jira". Alternatively use the `ai` script as an alias for `npm run` which doesnt required the -- seperator, and can be run from any directory.',
		);

	logger.debug({ functionClasses }, 'Parsed function classes');
	// logger.info(initialPrompt);

	// If no prompt provided then load from file
	if (!initialPrompt.trim()) {
		if (existsSync(`src/cli/${scriptName}-in`)) initialPrompt = readFileSync(`src/cli/${scriptName}-in`, 'utf-8');
	}

	// logger.info(initialPrompt);

	return {
		scriptName,
		resumeAgentId,
		initialPrompt,
		functionClasses,
		useSharedRepos,
		llmId,
		flags,
	};
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
