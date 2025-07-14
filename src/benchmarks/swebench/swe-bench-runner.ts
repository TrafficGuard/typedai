import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '#o11y/logger';
import { execCommand, failOnError } from '#utils/exec';

export interface SWEInstance {
	instance_id: string;
	// text: string;
	repo: string;
	base_commit: string;
	problem_statement: string;
	hints_text: string;
	created_at: string;
	patch: string;
	test_patch: string;
	version: string;
	FAIL_TO_PASS: string;
	PASS_TO_PASS: string;
	environment_setup_commit: string;
}

function getIssueImageName(problemId: string): string {
	return `ghcr.io/epoch-research/swe-bench.eval.x86_64.${problemId}:latest`;
}

export async function stopContainer(containerIdOrName: string): Promise<void> {
	logger.info(`Stopping and removing container ${containerIdOrName}`);
	// Use execCommand but ignore errors since container might not exist.
	await execCommand(`docker stop ${containerIdOrName}`).catch(() => {
		/* ignore */
	});
	await execCommand(`docker rm ${containerIdOrName}`).catch(() => {
		/* ignore */
	});
}

export const CONTAINER_PATH = '/testbed';

export async function startContainer(workspacePath: string, problemId: string): Promise<{ containerId: string; repoPathOnHost: string }> {
	const containerName = `sweb.augment.${problemId}_${uuidv4().slice(0, 8)}`;
	await stopContainer(containerName); // Clean up previous runs if any

	const imageName = getIssueImageName(problemId);
	logger.info(`Pulling image ${imageName}`);
	failOnError(`Failed to pull image ${imageName}`, await execCommand(`docker pull ${imageName}`));

	logger.info(`Starting container for ${problemId} with name ${containerName}`);
	const runResult = await execCommand(
		`docker run --name ${containerName} -d -v ${CONTAINER_PATH} ${imageName} bash -c "git config --global user.email a && git config --global user.name a && git config --global --add safe.directory ${CONTAINER_PATH} && git commit --allow-empty -am augment && sleep 7200"`,
	);
	failOnError(`Failed to start container for ${problemId}`, runResult);
	const containerId = runResult.stdout.trim();

	await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait for container to be ready

	const inspectResult = await execCommand(`docker inspect ${containerId}`);
	failOnError(`Failed to inspect container ${containerId}`, inspectResult);
	const inspectData = JSON.parse(inspectResult.stdout);
	const volumePath = inspectData[0].Mounts.find((m: any) => m.Destination === CONTAINER_PATH)?.Source;
	if (!volumePath) {
		throw new Error(`Could not find volume path for ${CONTAINER_PATH}`);
	}

	const repoPathOnHost = path.join(workspacePath, problemId);
	// Use rm instead of unlink to handle both files and directories (symlinks)
	await fs.rm(repoPathOnHost, { recursive: true, force: true });
	await fs.symlink(volumePath, repoPathOnHost, 'dir');

	// Note: The original python script attempted to set volume permissions with sudo.
	// This is skipped here as it's highly environment-dependent. The user running
	// this script may need to have appropriate permissions for Docker volumes.

	return { containerId, repoPathOnHost };
}

async function generatePatch(repoPath: string): Promise<string> {
	logger.info(`Generating patch in ${repoPath}`);
	const result = await execCommand('git --no-pager diff -U5 --no-color HEAD', { workingDirectory: repoPath });
	failOnError(`Failed to generate patch in ${repoPath}`, result);
	return result.stdout;
}

async function runEvaluation(predictionsFile: string, dataset: string, runId: string, swebenchVenvPath: string): Promise<void> {
	const reportDir = path.dirname(predictionsFile);
	const instanceId = JSON.parse(await fs.readFile(predictionsFile, 'utf-8'))[0].instance_id;

	await stopContainer(`sweb.eval.${instanceId}.swe_work`);

	const cmdParts = [
		path.join(swebenchVenvPath, 'bin', 'python'),
		'-m',
		'swebench.harness.run_evaluation',
		'--dataset_name',
		dataset,
		'--predictions_path',
		path.basename(predictionsFile),
		'--run_id',
		runId,
		'--report_dir',
		'.', // report dir is relative to cwd
		'--cache_level',
		'instance',
		'--namespace',
		'epoch-research/swe-bench',
		'--instance_image_tag',
		'latest',
	];
	const cmd = cmdParts.join(' ');

	logger.info(`Running evaluation: ${cmd} in ${reportDir}`);
	try {
		// The original python script has complex retry logic which is simplified here.
		// Using execCommand which doesn't stream stdio. Output will be logged after completion.
		const result = await execCommand(cmd, { workingDirectory: reportDir });
		logger.info(result.stdout);
		if (result.stderr) logger.error(result.stderr);
		failOnError('Evaluation failed', result);
	} catch (e) {
		logger.error('Evaluation failed', e);
	}
}

async function runEvalOnSingleProblem(problemId: string, workspacePath: string): Promise<{ is_success: boolean }> {
	const predictionsFile = path.join(workspacePath, 'predictions.json');
	const evalOutcomes = { is_success: false };

	try {
		const swebenchVenvPath = process.env.SWEBENCH_VENV_PATH || path.join(process.env.HOME, 'swebench_eval_tools_env');
		await runEvaluation(predictionsFile, 'princeton-nlp/SWE-bench', problemId, swebenchVenvPath);

		const evalFile = path.join(workspacePath, `typedai-agent.${problemId}.json`);
		const evalDict = JSON.parse(await fs.readFile(evalFile, 'utf-8'));
		if (evalDict.resolved_ids.includes(problemId)) {
			evalOutcomes.is_success = true;
		}
		logger.info(`Evaluated ${problemId} successfully.`);
	} catch (e) {
		logger.error(`Failed to report results for ${problemId}`, e);
	}
	return evalOutcomes;
}

export async function runAgentOnSingleProblem(
	problem: SWEInstance,
	rolloutIdx: number,
	workspaceBasePath: string,
): Promise<{ diff: string; duration: number; evalOutcomes: { is_success: boolean } }> {
	const { instance_id: problemId } = problem;
	const logsPrefix = `[${problemId}]`;
	logger.info(`${logsPrefix} Starting rollout ${rolloutIdx}`);

	const workspacePath = path.join(workspaceBasePath, problemId, `rollout_${rolloutIdx}`);
	await fs.mkdir(workspacePath, { recursive: true });

	let containerId: string;
	let repoPathOnHost: string;
	let diff: string;
	let duration: number;

	try {
		({ containerId, repoPathOnHost } = await startContainer(workspacePath, problemId));
		logger.info(`${logsPrefix} Docker container started with ID: ${containerId}`);

		await fs.writeFile(path.join(repoPathOnHost, 'instance.json'), JSON.stringify(problem, null, 2));

		logger.info(`${logsPrefix} Starting Node.js agent run...`);
		const startTime = Date.now();

		const agentEntrypoint = path.resolve(process.cwd(), 'src/cli/swe-bench-agent.ts');

		const agentCmd = `node --env-file=variables/local.env -r esbuild-register ${agentEntrypoint} --container-id ${containerId} "${problem.problem_statement.replace(/"/g, '\\"')}"`;
		logger.info(`Executing agent: ${agentCmd} in ${repoPathOnHost}`);
		// Note: execCommand buffers output. For long-running agents, live output is not available.
		const agentResult = await execCommand(agentCmd, { workingDirectory: repoPathOnHost });
		logger.info(agentResult.stdout);
		if (agentResult.stderr) {
			logger.error(agentResult.stderr);
		}
		failOnError('Agent run failed', agentResult);

		duration = (Date.now() - startTime) / 1000;
		logger.info(`${logsPrefix} Agent run completed in ${duration.toFixed(2)}s.`);

		diff = await generatePatch(repoPathOnHost);
		const predictions = [
			{
				instance_id: problemId,
				model_name_or_path: 'typedai-agent',
				model_patch: diff,
			},
		];
		await fs.writeFile(path.join(workspacePath, 'predictions.json'), JSON.stringify(predictions, null, 2));
	} finally {
		if (containerId) {
			logger.info(`${logsPrefix} Stopping Docker container...`);
			await stopContainer(containerId);
			logger.info(`${logsPrefix} Docker container stopped`);
		}
	}

	logger.info(`${logsPrefix} Evaluating the generated diff...`);
	const evalStartTime = Date.now();
	const evalOutcomes = await runEvalOnSingleProblem(problemId, workspacePath);
	const evalDuration = (Date.now() - evalStartTime) / 1000;
	logger.info(`${logsPrefix} Evaluation completed in ${evalDuration.toFixed(2)}s.`);

	return { diff, duration, evalOutcomes };
}
