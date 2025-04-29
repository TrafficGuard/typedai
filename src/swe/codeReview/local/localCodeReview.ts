import type { MergeRequestDiscussionNotePositionOptions } from '@gitbeaker/rest';
import { Git } from '#functions/scm/git';
import { logger } from '#o11y/logger';
import { addCodeWithLineNumbers, generateReviewTaskFingerprint, reviewDiff, shouldApplyCodeReview } from '#swe/codeReview/codeReviewCommon';
import type { CodeReviewConfig, CodeReviewTask } from '#swe/codeReview/codeReviewModel';
import { type DiffInfo, parseGitDiff } from '#swe/codeReview/local/parseGitDiff';
import { allSettledAndFulFilled, settleAllWithInput } from '#utils/async-utils';
import { appContext } from '../../../applicationContext';

/**
 * Performs a code review of a local branch
 */
export async function performLocalBranchCodeReview() {
	const git = new Git();
	await checkInvalidBranch();

	const codeReviewService = appContext().codeReviewService;
	const codeReviewConfigs: CodeReviewConfig[] = (await codeReviewService.listCodeReviewConfigs()).filter((config) => config.enabled);
	const projectPath = await getProjectPath();
	const allDiffs = parseGitDiff(await git.getDiff());
	const diffs = allDiffs.filter((diff) => !diff.deletedFile);

	const codeReviewTasks: CodeReviewTask[] = [];

	logger.info(`Found ${codeReviewConfigs.length} active code review configs`);

	for (const diff of diffs) {
		if (diff.deletedFile || !diff.diff || diff.diff.trim() === '') continue;

		for (const config of codeReviewConfigs) {
			if (shouldApplyCodeReview(config, projectPath, diff.newPath, diff.diff)) codeReviewTasks.push(createCodeReviewTask(config, diff));
		}
	}
	logger.info(`Found ${codeReviewTasks.length} review tasks needing LLM analysis.`);
	if (!codeReviewTasks.length) return;

	// Perform LLM Reviews
	const settled = await settleAllWithInput(codeReviewTasks, reviewDiff);
	const codeReviewResults = settled.fulfilled;

	for (const rejected of settled.rejected) {
		console.log(`Error executing review ${rejected.input.config.title}. Error: ${rejected.reason.message || rejected.reason}`);
	}

	// Display review comments
	for (const reviewResult of codeReviewResults) {
		if (!reviewResult.comments || !reviewResult.comments.length) continue;

		for (const comment of reviewResult.comments) {
			console.log();
			console.log(`== Review @ ${reviewResult.task.filePath}:${comment.lineNumber}   ======================================`);
			console.log(`-- Config: ${reviewResult.task.config.title}`);
			console.log('-- Code --------------------------------------------------------');
			console.log(reviewResult.task.code);
			console.log(`\n-- Comment @ line:${comment.lineNumber} ------------------------------------------`);
			console.log(comment.comment);
			console.log('----------------------------------------------------------------');
		}
	}
}

function createCodeReviewTask(config: CodeReviewConfig, mrDiff: DiffInfo): CodeReviewTask {
	const { codeWithLineNums, code } = addCodeWithLineNumbers(mrDiff.diff, mrDiff.newPath);

	return {
		config,
		filePath: mrDiff.newPath,
		oldPath: mrDiff.oldPath,
		codeWithLineNums,
		fingerprint: '',
		code,
	};
}

async function checkInvalidBranch() {
	const branchName = await new Git().getBranchName();
	if (branchName === 'main' || branchName === 'master' || branchName === 'dev' || branchName === 'develop') {
		throw new Error('Reviews should be a on a feature branch');
	}
}

/**
 * Get the project path from the repo origin URL
 */
async function getProjectPath(): Promise<string> {
	return '';
}
