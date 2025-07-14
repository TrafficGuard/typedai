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

async function loadDataset(datasetName: string, split: string, numExamples?: number): Promise<SWEInstance[]> {
	const limit = numExamples || 100;
	const url = `https://datasets-server.huggingface.co/rows?dataset=${datasetName}&config=default&split=${split}&offset=0&limit=${limit}`;
	logger.info(`Loading dataset from ${url}`);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch dataset: ${response.statusText}`);
	}
	const data = await response.json();
	return data.rows.map((row: any) => row.row as SWEInstance);
}

async function main() {
	registerErrorHandlers();

	const cliOptions = parseUserCliArgs('run-swe-bench', process.argv.slice(2));
	const { flags } = cliOptions;

	const numExamplesFlag = flags['num-examples'] ? Number(flags['num-examples']) : undefined;
	const shardCt = flags['shard-ct'] ? Number(flags['shard-ct']) : 1;
	const shardId = flags['shard-id'] ? Number(flags['shard-id']) : 0;
	const numProcesses = flags['num-processes'] ? Number(flags['num-processes']) : 8;
	const numCandidateSolutions = flags['num-candidate-solutions'] ? Number(flags['num-candidate-solutions']) : 8;

	logger.info('Loading SWE-bench dataset...');
	const fullDataset = await loadDataset('princeton-nlp/SWE-bench_Verified', 'test');

	const shardSize = Math.floor(fullDataset.length / shardCt);
	const examples = fullDataset.slice(shardId * shardSize, (shardId + 1) * shardSize);

	const numExamplesToRun = numExamplesFlag ? Math.min(numExamplesFlag, examples.length) : examples.length;
	const examplesToRun = examples.slice(0, numExamplesToRun);

	logger.info(`Running on ${numExamplesToRun} examples from shard ${shardId}/${shardCt}.`);
	logger.info(`Generating ${numCandidateSolutions} candidates per example with parallelism ${numProcesses}.`);
	logger.info(
		'Selected examples:',
		examplesToRun.map((e) => e.instance_id).join(', '),
	);

	const allDiffData = [];
	const workspaceBasePath = path.resolve(`/tmp/workspace/${uuidv4().slice(0, 8)}`);
	logger.info(`Workspace base path: ${workspaceBasePath}`);

	const outputPath = `pre-ensemble_results_shard${shardId}_of_${shardCt}.jsonl`;

	const limit = pLimit(numProcesses);

	for (let i = 0; i < examplesToRun.length; i++) {
		const problem = examplesToRun[i];
		logger.info(`\nProcessing example ${i + 1}/${numExamplesToRun}: ${problem.instance_id}`);

		try {
			const rolloutPromises = Array.from({ length: numCandidateSolutions }, (_, rolloutIdx) =>
				limit(() => runAgentOnSingleProblem(problem, rolloutIdx, workspaceBasePath)),
			);

			const results = await Promise.all(rolloutPromises);

			const diffs = results.map((r) => r.diff);
			const agentDurations = results.map((r) => r.duration);
			const evalOutcomes = results.map((r) => r.evalOutcomes);

			const median = (arr: number[]) => {
				const mid = Math.floor(arr.length / 2),
					nums = [...arr].sort((a, b) => a - b);
				return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
			};

			const diffData = {
				id: problem.instance_id,
				instruction: problem.problem_statement,
				diffs,
				agentDurations,
				median_duration: median(agentDurations),
				eval_outcomes: evalOutcomes,
			};
			allDiffData.push(diffData);

			const outputData = allDiffData.map((d) => JSON.stringify(d)).join('\n');
			await fs.writeFile(outputPath, outputData + '\n');

			logger.info(`Completed example ${i + 1}/${numExamplesToRun}`);
		} catch (e) {
			logger.error(`Error processing example ${problem.instance_id}:`, e);
			continue;
		}
	}

	logger.info(`\nAll examples processed. Results saved to ${outputPath}`);

	await shutdownTrace();
}

main().catch((e) => {
	logger.error(e);
	process.exit(1);
});
