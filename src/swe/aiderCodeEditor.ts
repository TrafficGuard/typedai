import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'node:child_process';
import fs, { readFile, unlinkSync } from 'node:fs';
import path, { join } from 'path';
import { promisify } from 'util';
import { addCost, agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { LLM } from '#llm/llm';
import { Claude3_7_Sonnet } from '#llm/services/anthropic';
import { Claude3_7_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { deepSeekV3 } from '#llm/services/deepseek';
import { GPT4o } from '#llm/services/openai';
import { logger } from '#o11y/logger';
import { getActiveSpan } from '#o11y/trace';
import { currentUser } from '#user/userService/userContext';
import { execCommand } from '#utils/exec';
import { systemDir } from '../appVars';

@funcClass(__filename)
export class AiderCodeEditor {
	/**
	 * Makes the changes to the project files to meet the task requirements
	 * @param requirements the complete task requirements with all the supporting documentation and code samples
	 * @param filesToEdit the names of any existing relevant files to edit
	 */
	@func()
	async editFilesToMeetRequirements(requirements: string, filesToEdit: string[], commit = true): Promise<void> {
		const span = getActiveSpan();
		const messageFilePath = '.aider-requirements';
		logger.debug(requirements);
		logger.debug(filesToEdit);
		// TODO insert additional info into the prompt
		// We could have languageTools.getPrompt()
		// See if a project has a AI-code.md file
		// or like https://aider.chat/docs/usage/conventions.html
		// If we're writing tests have a prompt for test styles
		await getFileSystem().writeFile(messageFilePath, requirements);
		// A blank entry was getting here which would cause Aider to error
		filesToEdit = filesToEdit.filter((file) => file?.trim().length);

		// https://aider.chat/docs/llms.html
		let env: any = undefined;
		let modelArg = '';
		const anthropicKey = currentUser().llmConfig.anthropicKey || process.env.ANTHROPIC_API_KEY;
		const deepSeekKey = currentUser().llmConfig.deepseekKey || process.env.DEEPSEEK_API_KEY;
		const openaiKey = currentUser().llmConfig.openaiKey || process.env.OPENAI_API_KEY;

		let llm: LLM;

		if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_CLAUDE_REGION) {
			llm = Claude3_7_Sonnet_Vertex();
			modelArg = `--model vertex_ai/${llm.getModel()}`;
			span.setAttribute('model', 'sonnet');
			env = { VERTEXAI_PROJECT: process.env.GCLOUD_PROJECT, VERTEXAI_LOCATION: process.env.GCLOUD_CLAUDE_REGION };
		} else if (anthropicKey) {
			modelArg = '--sonnet';
			env = { ANTHROPIC_API_KEY: anthropicKey };
			span.setAttribute('model', 'sonnet');
			llm = Claude3_7_Sonnet();
		} else if (deepSeekKey) {
			modelArg = '--model deepseek/deepseek-chat';
			env = { DEEPSEEK_API_KEY: deepSeekKey };
			span.setAttribute('model', 'deepseek');
			llm = deepSeekV3();
		} else if (openaiKey) {
			// default to gpt4o
			modelArg = '';
			env = { OPENAI_API_KEY: openaiKey };
			span.setAttribute('model', 'openai');
			llm = GPT4o();
		} else {
			throw new Error(
				'Aider code editing requires either GCLOUD_PROJECT and GCLOUD_CLAUDE_REGION env vars set or else a key for Anthropic, Deepseek or OpenAI',
			);
		}

		// Use the TypedAI system directory, not the FileSystem working directory
		// as we want all the 'system' files in one place.
		const agentId = agentContext()?.agentId ?? 'NONE';
		const llmHistoryFolder = join(systemDir(), 'aider/llm-history');
		await promisify(fs.mkdir)(llmHistoryFolder, { recursive: true });
		const llmHistoryFile = `${llmHistoryFolder}/${getFormattedDate()}__${agentId}`;

		logger.info(`LLM history file ${llmHistoryFile}`);
		try {
			writeFileSync(llmHistoryFile, '');
		} catch (e) {
			logger.error(e, 'Fatal Error reading/writing Aider llmH-history-file');
			const error = new Error(`Fatal Error reading/writing Aider llm-history-file. Error: ${e.message}`);
			if (e.stack) error.stack = e.stack;
			throw error;
		}

		const commitArgs: string = commit ? '' : '--no-dirty-commits --no-auto-commits';

		// Due to limitations in the provider APIs, caching statistics and costs are not available when streaming responses.
		// --map-tokens=2048
		// Use the Python from the TypedAI .python-version as it will have aider installed
		const fileToEditArg = filesToEdit.map((file) => `"${file}"`).join(' ');
		logger.info(fileToEditArg);
		const cmd = `${getPythonPath()} -m aider --no-check-update --cache-prompts ${commitArgs} --no-stream --yes ${modelArg} --llm-history-file="${llmHistoryFile}" --message-file=${messageFilePath} ${fileToEditArg}`;

		const { stdout, stderr, exitCode } = await execCommand(cmd, { envVars: env });
		if (stdout) logger.info(stdout);
		if (stderr) logger.error(stderr);

		try {
			const cost = extractSessionCost(stdout);
			addCost(cost);
			logger.debug(`Aider cost ${cost}`);
			// const costs = llm.calculateCost(parsedInput, parsedOutput);
			// addCost(costs[0]);
			// logger.debug(`Aider cost ${costs[0]}`);

			const llmHistory = readFileSync(llmHistoryFile).toString();
			const parsedInput = this.parseAiderInput(llmHistory);
			const parsedOutput = this.parseAiderOutput(llmHistory);

			span.setAttributes({
				inputChars: parsedInput.length,
				outputChars: parsedOutput.length,
				cost: cost,
			});
			// unlinkSync(llmHistoryFile);
			// TODO should save them as LLMCalls
		} catch (e) {
			logger.error(e);
		}

		if (exitCode > 0) throw new Error(`${stdout} ${stderr}`);
	}

	private parseAiderInput(output: string): string {
		return output
			.split('\n')
			.filter((line) => line.startsWith('SYSTEM') || line.startsWith('USER'))
			.map((line) => line.replace(/^(SYSTEM|USER)\s/, ''))
			.join('\n');
	}

	private parseAiderOutput(output: string): string {
		return output
			.split('\n')
			.filter((line) => line.startsWith('ASSISTANT'))
			.map((line) => line.replace(/^ASSISTANT\s/, ''))
			.join('\n');
	}
}

function extractSessionCost(text: string): number {
	const regex = /Cost:.*\$(\d+(?:\.\d+)?) session/;
	const match = text.match(regex);

	if (match?.[1]) {
		return parseFloat(match[1]);
	}

	return 0; // Return null if no match is found
}

export function getPythonPath() {
	// Read the TypedAI .python-version file
	const pythonVersionFile = path.join(process.env.TYPEDAI_HOME || process.cwd(), '.python-version');
	const pythonVersion = fs.readFileSync(pythonVersionFile, 'utf8').trim();
	// Use pyenv to find the path of the specified Python version
	return `${execSync(`pyenv prefix ${pythonVersion}`, { encoding: 'utf8' }).trim()}/bin/python`;
}

function getFormattedDate() {
	const now = new Date();

	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	const hours = String(now.getHours()).padStart(2, '0');
	const minutes = String(now.getMinutes()).padStart(2, '0');
	const seconds = String(now.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}
