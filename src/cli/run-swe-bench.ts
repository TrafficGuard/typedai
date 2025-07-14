import '#fastify/trace-init/trace-init';

import { parseUserCliArgs } from '#cli/cli';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { logger } from '#o11y/logger';
import { type SWEInstance } from '#swe/SWEBenchAgent';
import { runAgentOnSingleProblem } from 'src/benchmarks/swebench/swe-bench-runner';
import { promises as fs } from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import { registerErrorHandlers } from '../errorHandlers';

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

	const cliOptions = parseUserCliArgs('swebench', process.argv.slice(2));
	const { flags } = cliOptions;

	const instanceIdFlag = flags['instance-id'] as string;
	const numExamplesFlag = flags['num-examples'] ? Number(flags['num-examples']) : undefined;
	const shardCt = flags['shard-ct'] ? Number(flags['shard-ct']) : 1;
	const shardId = flags['shard-id'] ? Number(flags['shard-id']) : 0;
	const numProcesses = flags['num-processes'] ? Number(flags['num-processes']) : 8;
	const numCandidateSolutions = flags['num-candidate-solutions'] ? Number(flags['num-candidate-solutions']) : 8;

	logger.info('Loading SWE-bench dataset...');
	const fullDataset = await loadDataset('princeton-nlp/SWE-bench_Verified', 'test');

	let examplesToRun: SWEInstance[];

	if (instanceIdFlag) {
		const problem = fullDataset.find((p) => p.instance_id === instanceIdFlag);
		if (!problem) {
			logger.error(`Instance with ID "${instanceIdFlag}" not found.`);
			process.exit(1);
		}
		examplesToRun = [problem];
		logger.info(`Running on single specified instance: ${instanceIdFlag}`);
	} else {
		const shardSize = Math.floor(fullDataset.length / shardCt);
		const examples = fullDataset.slice(shardId * shardSize, (shardId + 1) * shardSize);

		const numExamplesToRun = numExamplesFlag ? Math.min(numExamplesFlag, examples.length) : examples.length;
		examplesToRun = examples.slice(0, numExamplesToRun);

		logger.info(`Running on ${numExamplesToRun} examples from shard ${shardId}/${shardCt}.`);
		logger.info(`Generating ${numCandidateSolutions} candidates per example with parallelism ${numProcesses}.`);
		logger.info(
			'Selected examples:',
			examplesToRun.map((e) => e.instance_id).join(', '),
		);
	}

	const allDiffData = [];
	const workspaceBasePath = path.resolve(`/tmp/workspace/${uuidv4().slice(0, 8)}`);
	logger.info(`Workspace base path: ${workspaceBasePath}`);
