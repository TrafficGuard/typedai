import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { promises as fs, readFileSync } from 'fs';
import { AgentLLMs } from '#agent/agentContextTypes';
import { AGENT_COMPLETED_PARAM_NAME } from '#agent/agentFunctions';
import { startAgentAndWait } from '#agent/agentRunner';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { LlmTools } from '#functions/util';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { lastText } from '#llm/llm';
import { LlmCall } from '#llm/llmCallService/llmCall';
import { Claude3_5_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { groqLlama3_3_70B } from '#llm/services/groq';
import { openAIo1 } from '#llm/services/openai';
import { Gemini_2_0_Flash } from '#llm/services/vertexai';
import { logger } from '#o11y/logger';
import { sleep } from '#utils/async-utils';
import { appContext, initFirestoreApplicationContext } from '../applicationContext';

const SYSTEM_PROMPT = `Finish your answer with the following template: FINAL ANSWER: [YOUR FINAL ANSWER]. YOUR FINAL ANSWER should be a number OR as few words as possible OR a comma separated list of numbers and/or strings. If you are asked for a number, don't use comma to write your number neither use units such as $ or percent sign unless specified otherwise. If you are asked for a string, don't use articles, neither abbreviations (e.g. for cities), and write the digits in plain text unless specified otherwise. If you are asked for a comma separated list, apply the above rules depending of whether the element to be put in the list is a number or a string.`;

const tasksFile = 'benchmarks/gaia.json';
const resultsFile = 'benchmarks/gaia.jsonl';

let llms: AgentLLMs;

export interface GaiaQuestion {
	task_id: string;
	Question: string;
	Level: string;
	'Final answer': string;
	file_name: string;
	file_path: string;
}

export interface GaiaResult {
	task_id: string;
	model_answer: string;
	reasoning_trace: string[];
}

async function readJsonFile(filePath: string): Promise<any> {
	try {
		const data = await fs.readFile(filePath, 'utf8');
		return JSON.parse(data);
	} catch (error) {
		logger.error(`Error reading JSON file ${filePath}:`, error);
		throw error;
	}
}

async function writeJsonlFile(filePath: string, data: GaiaResult): Promise<void> {
	try {
		let existingContent = '';
		try {
			existingContent = await fs.readFile(filePath, 'utf8');
		} catch (error) {
			// File doesn't exist, we'll create it
		}

		const lines = existingContent.split('\n').filter((line) => line.trim() !== '');
		const updatedLines = lines.filter((line) => {
			const parsedLine = JSON.parse(line);
			return parsedLine.task_id !== data.task_id;
		});

		updatedLines.push(JSON.stringify(data));
		const jsonlContent = `${updatedLines.join('\n')}\n`;

		await fs.writeFile(filePath, jsonlContent, 'utf8');
	} catch (error) {
		logger.error(`Error writing JSONL file ${filePath}:`, error);
		throw error;
	}
}

async function answerGaiaQuestion(task: GaiaQuestion): Promise<GaiaResult> {
	if (!task.Question) throw Error(`No question for task ${JSON.stringify(task)}`);

	let prompt = `${SYSTEM_PROMPT}\n\n${task.Question}`;
	if (task.file_name) {
		prompt += `\nFile location: ${task.file_name}`;
	}
	let budget = 1;
	if (task.Level === '2') budget = 2;
	if (task.Level === '3') budget = 4;

	try {
		const agentId = await startAgentAndWait({
			initialPrompt: prompt,
			// llms: ClaudeVertexLLMs(),
			llms: {
				easy: Gemini_2_0_Flash(),
				medium: groqLlama3_3_70B(),
				hard: Claude3_5_Sonnet_Vertex(),
				xhard: openAIo1(),
			},
			agentName: `gaia-${task.task_id}`,
			type: 'codegen',
			humanInLoop: {
				budget,
				count: 100,
			},
			functions: [PublicWeb, Perplexity, FileSystemRead, LlmTools],
		});

		const agent = await appContext().agentStateService.load(agentId);
		const llmCalls = await appContext().llmCallService.getLlmCallsForAgent(agentId);

		// Extract reasoning trace from LLM calls
		const reasoningTrace: string[] = llmCalls
			.filter((call: LlmCall) => lastText(call.messages).includes('<python-code>'))
			.map((call) => {
				const match = lastText(call.messages).match(/<python-code>(.*?)<\/python-code>/s);
				return match ? match[1].trim() : '';
			});

		// Extract model answer from the last function call
		const completedCall = agent.functionCallHistory[agent.functionCallHistory.length - 1];
		const modelAnswer = completedCall.parameters[AGENT_COMPLETED_PARAM_NAME].match(/FINAL ANSWER: (.*)/)?.[1] || '';

		return {
			task_id: task.task_id,
			model_answer: modelAnswer,
			reasoning_trace: [], //reasoningTrace,
		};
	} catch (error) {
		logger.error(`Error running Gaia task ${task.task_id}:`, error);
		throw error;
	}
}

async function main() {
	if (process.env.GCLOUD_PROJECT) {
		await initFirestoreApplicationContext();
		llms = defaultLLMs();
	} else {
		llms = defaultLLMs();
	}

	const args = process.argv.slice(2);
	const questions = JSON.parse(readFileSync(tasksFile).toString()) as GaiaQuestion[];
	if (args.length === 0) {
		logger.info('Running entire Gaia benchmark...');
		await sleep(1000);
		for (const question of questions) {
			const result = await answerGaiaQuestion(question);
			await writeJsonlFile(resultsFile, result);
		}
	} else if (args.length === 1) {
		const taskId = args[0];
		const question = questions.find((q) => q.task_id === taskId);
		if (!question) {
			logger.error(`No task found with id ${taskId}`);
			process.exit(1);
		}
		const result = await answerGaiaQuestion(question);
		await writeJsonlFile(resultsFile, result);
	} else {
		throw new Error('Only 1 arg supported');
	}
	logger.info(`Benchmark completed. Results appended to ${resultsFile}`);
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
