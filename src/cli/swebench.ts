import '#fastify/trace-init/trace-init';

import { startAgentAndWaitForCompletion } from '#agent/autonomous/autonomousAgentRunner';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { initApplicationContext } from '#app/applicationContext';
import { startContainer, stopContainer, type SWEInstance } from '#benchmarks/swebench/swe-bench-runner';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { CodeFunctions } from '#swe/codeFunctions';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { registerErrorHandlers } from '../errorHandlers';
import { parseProcessArgs } from './cli';

async function loadDataset(datasetName: string, split: string): Promise<SWEInstance[]> {
	const url = `https://huggingface.co/datasets/${datasetName}/resolve/main/swe-bench.json`;
	logger.info(`Loading dataset from ${url}`);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch dataset: ${response.statusText}`);
	}
	const data = await response.json();
	return data as SWEInstance[];
}

async function main() {
	registerErrorHandlers();
	await initApplicationContext();
	const llms = defaultLLMs();

	const { flags } = parseProcessArgs();
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
		({ containerId, repoPathOnHost } = await startContainer(workspacePath, problem.instance_id));

		const functions = [CodeEditingAgent, CodeFunctions, LiveFiles, FileSystemTree, FileSystemList];

		logger.info(`Available functions ${functions.map((f) => f.name).join(', ')}`);

		const requirements = `Please fix the following issue:\n${problem.problem_statement}`;

		const agentName = `SWE-bench agent for: ${problem.problem_statement.slice(0, 50)}...`;

		logger.info('Starting new swebench agent');
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
		await cleanup();
	}
}
