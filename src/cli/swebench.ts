import '#fastify/trace-init/trace-init';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { startAgentAndWaitForCompletion } from '#agent/autonomous/autonomousAgentRunner';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { initApplicationContext } from '#app/applicationContext';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { CodeFunctions } from '#swe/codeFunctions';
import { type SWEInstance, startContainer, stopContainer } from '../benchmarks/swebench/swe-bench-runner';
import { registerErrorHandlers } from '../errorHandlers';
import { parseProcessArgs } from './cli';

async function loadDataset(datasetName: string, split: string): Promise<SWEInstance[]> {
	// const url = `https://huggingface.co/datasets/${datasetName}/resolve/main/swe-bench.json`;
	// logger.info(`Loading dataset from ${url}`);
	// const response = await fetch(url);
	// if (!response.ok) {
	// 	throw new Error(`Failed to fetch dataset: ${response.statusText}`);
	// }
	// const data = await response.json();
	// return data as SWEInstance[];
	return JSON.parse((await fs.readFile('bench/datasets/SWE-bench_Verified/dataset.json', 'utf-8')).toString()) as SWEInstance[];
}

async function main() {
	registerErrorHandlers();
	await initApplicationContext();
	const llms = defaultLLMs();

	const { flags } = parseProcessArgs();
	// Test instance ID
	const instanceId = flags['instance-id'] as string;
	if (!instanceId) {
		throw new Error('An --instance-id must be provided.');
	}

	const fullDataset = await loadDataset('princeton-nlp/SWE-bench_Verified', 'test');
	const problem = fullDataset.find((p) => p.instance_id === instanceId);
	if (!problem) {
		logger.error(`Instance with ID "${instanceId}" not found.`);
		process.exit(1);
	}
	logger.info('Found problem instance', { problemId: problem.instance_id });

	const workspacePath = path.resolve(`/tmp/workspace/${uuidv4().slice(0, 8)}`);
	await fs.mkdir(workspacePath, { recursive: true });

	let containerId: string;
	let repoPathOnHost: string;

	const cleanup = async () => {
		if (containerId) {
			await stopContainer(containerId);
		}
	};

	process.on('SIGINT', async () => {
		logger.info('Caught interrupt signal, cleaning up...');
		await cleanup();
		process.exit();
	});
	process.on('SIGTERM', async () => {
		logger.info('Caught terminate signal, cleaning up...');
		await cleanup();
		process.exit();
	});

	try {
		logger.info('Starting container...');
		({ containerId, repoPathOnHost } = await startContainer(workspacePath, problem.instance_id));
		logger.info('Container started successfully', { containerId, repoPathOnHost });

		const functions = [CodeEditingAgent, CodeFunctions, LiveFiles, FileSystemTree, FileSystemList];

		logger.info(`Available functions ${functions.map((f) => f.name).join(', ')}`);

		const requirements = `Please fix the following issue:\n${problem.problem_statement}`;

		const agentName = `SWE-bench agent: ${problem.problem_statement.slice(0, 50)}...`;

		logger.info('Starting new swebench agent');
		logger.info('Starting agent...');
		const result = await startAgentAndWaitForCompletion({
			agentName,
			initialPrompt: requirements,
			functions: functions,
			llms,
			type: 'autonomous',
			subtype: 'codegen',
			containerId,
			fileSystemPath: repoPathOnHost,
		});

		// The orchestrator will generate the patch via `git diff`.
		// This output can be used for debugging or if the agent directly produces a patch.
		console.log(result);
	} finally {
		logger.info('Entering finally block for cleanup...');
		await cleanup();
	}
}

main().catch(console.error);
