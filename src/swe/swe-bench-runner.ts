import { logger } from '#o11y/logger';
import { type SWEInstance } from '#swe/SWEBenchAgent';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

function getIssueImageName(problemId: string): string {
	return `ghcr.io/epoch-research/swe-bench.eval.x86_64.${problemId}:latest`;
}

async function stopContainer(containerIdOrName: string): Promise<void> {
	const { execa } = await import('execa');
	logger.info(`Stopping and removing container ${containerIdOrName}`);
	try {
		await execa('docker', ['stop', containerIdOrName], { stdio: 'pipe' });
	} catch (e) {
		// ignore, container might not be running
	}
	try {
		await execa('docker', ['rm', containerIdOrName], { stdio: 'pipe' });
	} catch (e) {
		// ignore, container might not exist
	}
}

async function startContainer(
	workspacePath: string,
	problemId: string,
): Promise<{ containerId: string; repoPathOnHost: string }> {
	const { execa } = await import('execa');
	const containerName = `sweb.augment.${problemId}_${uuidv4().slice(0, 8)}`;
	await stopContainer(containerName); // Clean up previous runs if any

	const imageName = getIssueImageName(problemId);
	logger.info(`Pulling image ${imageName}`);
	await execa('docker', ['pull', imageName]);

	logger.info(`Starting container for ${problemId} with name ${containerName}`);
	const { stdout: containerId } = await execa('docker', [
		'run',
		'--name',
		containerName,
		'-d',
		'-v',
		'/testbed', // Anonymous volume
		imageName,
		'bash',
		'-c',
		'git config --global user.email a && git config --global user.name a && git config --global --add safe.directory /testbed && git commit --allow-empty -am augment && sleep 7200',
	]);

	await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait for container to be ready

	const { stdout: inspectOutput } = await execa('docker', ['inspect', containerId]);
	const inspectData = JSON.parse(inspectOutput);
	const volumePath = inspectData[0].Mounts.find((m) => m.Destination === '/testbed')?.Source;
	if (!volumePath) {
		throw new Error('Could not find volume path for /testbed');
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
	const { execa } = await import('execa');
	logger.info(`Generating patch in ${repoPath}`);
	const { stdout } = await execa('git', ['--no-pager', 'diff', '-U5', '--no-color', 'HEAD'], { cwd: repoPath });
	return stdout;
}

async function runEvaluation(predictionsFile: string, dataset: string, runId: string, swebenchVenvPath: string): Promise<void> {
	const { execa } = await import('execa');
	const reportDir = path.dirname(predictionsFile);
	const instanceId = JSON.parse(await fs.readFile(predictionsFile, 'utf-8'))[0].instance_id;

	await stopContainer(`sweb.eval.${instanceId}.swe_work`);

	const cmd = [
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
		reportDir,
		'--cache_level',
		'instance',
		'--namespace',
		'epoch-research/swe-bench',
		'--instance_image_tag',
		'latest',
	];

	logger.info(`Running evaluation: ${cmd.join(' ')} in ${reportDir}`);
	try {
		await execa(cmd[0], cmd.slice(1), { cwd: reportDir, stdio: 'inherit' });
	} catch (e) {
		logger.error('Evaluation failed', e);
		// Note: The original python script has complex retry logic which is simplified here.
	}
}

async function runEvalOnSingleProblem(problemId: string, workspacePath: string): Promise<{ is_success: boolean }> {
	const predictionsFile = path.join(workspacePath, 'predictions.json');
	const evalOutcomes = { is_success: false };

	try {
		const swebenchVenvPath = process.env.SWEBENCH_VENV_PATH || path.join(process.env.HOME, 'swebench_eval_tools_env');
		await runEvaluation(predictionsFile, 'princeton-nlp/SWE-bench', problemId, swebenchVenvPath);

		const evalFile = path.join(workspacePath, `augment-agent.${problemId}.json`);
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

		const { execa } = await import('execa');
		const agentEntrypoint = path.resolve(process.cwd(), 'dist/cli/swebench.js');

		await execa('node', [agentEntrypoint, '--container-id', containerId], {
			cwd: repoPathOnHost,
			stdio: 'inherit',
		});

		duration = (Date.now() - startTime) / 1000;
		logger.info(`${logsPrefix} Agent run completed in ${duration.toFixed(2)}s.`);

		diff = await generatePatch(repoPathOnHost);
		const predictions = [
			{
				instance_id: problemId,
				model_name_or_path: 'augment-agent',
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
