import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import fs, { unlinkSync } from 'node:fs';
import path, { join } from 'node:path';
import { promisify } from 'node:util';
import { addCost, agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { systemDir } from '#app/appDirs';
import { appContext } from '#app/applicationContext';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { callStack } from '#llm/llmCallService/llmCall';
import { Claude3_7_Sonnet } from '#llm/services/anthropic';
import { deepSeekV3 } from '#llm/services/deepseek';
import { GPT4o } from '#llm/services/openai';
import { openRouterGemini2_5_Pro } from '#llm/services/openrouter';
import { vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import { logger } from '#o11y/logger';
import { getActiveSpan } from '#o11y/trace';
import type { LLM, LlmMessage } from '#shared/model/llm.model';
import { currentUser } from '#user/userContext';
import { execCommand } from '#utils/exec';
import type { LlmCall } from '../../shared/model/llmCall.model';

const GEMINI_KEYS: string[] = [];
if (process.env.GEMINI_API_KEY) GEMINI_KEYS.push(process.env.GEMINI_API_KEY);
for (let i = 2; i <= 9; i++) {
	const key = process.env[`GEMINI_API_KEY_${i}`];
	if (key) GEMINI_KEYS.push(key);
	else break;
}
let geminiKeyIndex = 0;

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

		if (GEMINI_KEYS.length) {
			const key = GEMINI_KEYS[geminiKeyIndex];
			if (++geminiKeyIndex > GEMINI_KEYS.length) geminiKeyIndex = 0;
			llm = openRouterGemini2_5_Pro();
			modelArg = '--model gemini/gemini-2.5-pro-exp-03-25';
			span.setAttribute('model', 'gemini 2.5 Pro');
			env = { GEMINI_API_KEY: key };
		} else if (process.env.GCLOUD_PROJECT) {
			//  && process.env.GCLOUD_CLAUDE_REGION
			llm = vertexGemini_2_5_Pro();
			modelArg = `--model vertex_ai/${llm.getModel()}`;
			span.setAttribute('model', llm.getModel());
			env = { VERTEXAI_PROJECT: process.env.GCLOUD_PROJECT, VERTEXAI_LOCATION: process.env.GCLOUD_REGION };
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
		const now = Date.now();
		const cmd = `${getPythonPath()} -m aider --no-check-update --cache-prompts ${commitArgs} --no-stream --yes ${modelArg} --llm-history-file="${llmHistoryFile}" --message-file=${messageFilePath} ${fileToEditArg}`;

		const { stdout, stderr, exitCode } = await execCommand(cmd, { envVars: env });
		if (stdout) logger.info(stdout);
		if (stderr) logger.error(stderr);

		try {
			const cost = extractSessionCost(stdout);
			addCost(cost);
			logger.debug(`Aider cost ${cost}`);

			const llmHistory = readFileSync(llmHistoryFile).toString();
			const calls = this.parseHistoryFile(llmHistory);
			let callCount = 0;
			for (const llmMessages of calls) {
				const llmCall: LlmCall = {
					id: randomUUID(),
					agentId: agentContext()?.agentId,
					llmId: llm?.getId(),
					messages: llmMessages,
					requestTime: now + callCount++,
					callStack: `${callStack()} > Aider`,
				};
				appContext()
					.llmCallService?.saveResponse(llmCall)
					.catch((error) => logger.error(error, 'Error saving Aider LlmCall'));
			}

			span.setAttributes({
				cost: cost,
			});
			unlinkSync(llmHistoryFile);
		} catch (e) {
			logger.error(e);
		}

		if (exitCode > 0) throw new Error(`${stdout} ${stderr}`);
	}

	private parseHistoryFile(text: string): LlmMessage[][] {
		const turns: LlmMessage[][] = [];
		// Split into individual LLM turns, removing the first empty element if present
		const turnBlocks = text.split(/^TO LLM .*$/m).filter((block) => block.trim());

		for (const block of turnBlocks) {
			const messages: LlmMessage[] = [];
			const lines = block.trim().split('\n');

			for (const line of lines) {
				// Skip separators and response markers
				if (line.startsWith('-------') || line.startsWith('LLM RESPONSE')) {
					continue;
				}

				const match = line.match(/^(SYSTEM|USER|ASSISTANT)\s?(.*)$/);
				if (match) {
					const role = match[1].toLowerCase() as 'system' | 'user' | 'assistant';
					const content = match[2];
					const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

					// If the last message has the same role, append content
					if (lastMessage && lastMessage.role === role) {
						lastMessage.content += `\n${content}`;
					} else {
						// Otherwise, start a new message
						messages.push({ role, content });
					}
				} else if (messages.length > 0) {
					// Handle lines that might not start with a role but belong to the previous message
					// (e.g., empty USER lines followed by content)
					// This assumes multi-line content without a role prefix belongs to the last message.
					// Aider format seems consistent with prefixing each line, but this adds robustness.
					const lastMessage = messages[messages.length - 1];
					lastMessage.content += `\n${line}`;
				}
				// Ignore lines that don't match
			}

			if (messages.length > 0) turns.push(messages);
		}
		return turns;
	}
}

/**
 * @param aiderStdOut
 * @returns the LLM cost, or zero if it could not be extracted
 */
function extractSessionCost(aiderStdOut: string): number {
	const regex = /Cost:.*\$(\d+(?:\.\d+)?) session/;
	const match = aiderStdOut.match(regex);
	return match?.[1] ? Number.parseFloat(match[1]) : 0;
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
