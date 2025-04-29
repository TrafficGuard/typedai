import util from 'node:util';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import type { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { execCommand, failOnError } from '#utils/exec';
import type { VersionControlSystem } from './versionControlSystem';
const exec = util.promisify(require('node:child_process').exec);

@funcClass(__filename)
export class Git implements VersionControlSystem {
	/** The branch name before calling switchToBranch. This enables getting the diff between the current and previous branch */
	previousBranch: string | undefined;

	constructor(private fileSystem: FileSystemService = getFileSystem()) {}

	/**
	 * Adds all files which are already tracked by version control to the index and commits.
	 * If there are no changes
	 * @param commitMessage
	 */
	async addAllTrackedAndCommit(commitMessage: string): Promise<void> {
		// If nothing has changed then return
		const execResult = await execCommand('git status --porcelain');
		if (execResult.exitCode === 0) return;

		const { exitCode, stdout, stderr } = await execCommand('git add .');
		if (exitCode > 0) throw new Error(`${stdout}\n${stderr}`);

		await this.commit(commitMessage);
	}

	/**
	 * Get the files added. If no commit argument if provided then it is for the head commit,
	 */
	async getAddedFiles(commitSha?: string): Promise<string[]> {
		if (commitSha !== undefined && commitSha !== null) {
			commitSha = commitSha.trim();
		}
		const { stdout } = await execCommand(`git diff --name-status ${commitSha ?? 'HEAD^'}..HEAD`);
		logger.debug(`getAddedFiles:\n${stdout}`);
		// Output is in the format
		// A       etc/newFile
		// A       src/cache/newFile.test.ts
		return stdout
			.split('\n')
			.filter((line: string) => line.startsWith('A'))
			.map((line) => line.slice(1).trim());
	}

	async init(): Promise<void> {
		const originUrl = await execCommand('git config --get remote.origin.url');
	}

	async getHeadSha(): Promise<string> {
		const execResult = await execCommand('git rev-parse HEAD');
		failOnError('Unable to get current commit sha', execResult);
		return execResult.stdout.trim();
	}

	@span()
	async getBranchName(): Promise<string> {
		const { exitCode, stdout, stderr } = await execCommand('git rev-parse --abbrev-ref HEAD');
		if (exitCode > 0) throw new Error(`${stdout}\n${stderr}`);
		return stdout.trim();
	}

	/**
	 * Returns the diff from the merge-base (common ancestor) of HEAD and a reference, up to HEAD.
	 * This effectively shows changes introduced on the current branch relative to that base.
	 *
	 * @param baseRef Optional commit SHA or branch name.
	 *                - If provided: Uses `git merge-base <baseRef> HEAD` to find the diff start point.
	 *                - If omitted: Attempts to guess the source branch (e.g., main, develop)
	 *                  by inspecting other local branches and uses that for the merge-base calculation.
	 *                  Note: Guessing the source branch may be unreliable in some cases.
	 * @returns The git diff.
	 */
	@func()
	async getDiff(baseRef?: string): Promise<string> {
		const command: string = baseRef?.length
			? `git --no-pager diff $(git merge-base ${baseRef} HEAD) HEAD`
			: // attempt to guess the source branch and find its merge-base with HEAD
				"git --no-pager diff $(git merge-base HEAD $(git for-each-ref --format='%(refname)' refs/heads/ | grep -v $(git symbolic-ref HEAD))) HEAD";

		const result = await execCommand(command);

		// Ensure failOnError handles potential errors from merge-base (if refs don't exist/relate) or diff
		failOnError(`Error getting diff against base '${baseRef}'`, result);
		return result.stdout;
	}

	/**
	 * Creates a new branch, or if it already exists then switches to it
	 * @param branchName
	 * @return if the branch was created, or false if switched to an existing one
	 */
	@span({ branch: 0 })
	async createBranch(branchName: string): Promise<boolean> {
		this.previousBranch = await this.getBranchName();

		const { stdout, stderr, exitCode } = await execCommand(`git branch ${branchName}`);
		if (exitCode === 0) {
			return true;
		}
		if (exitCode > 0 && stderr?.includes('already exists')) {
			logger.info(`Branch ${branchName} already exists. Switching to it`);
			await this.switchToBranch(branchName);
			return false;
		}
		if (exitCode > 0) throw new Error(`${stdout}\n${stderr}`);
	}

	/**
	 *
	 * @param branchName
	 */
	@span({ branch: 0 })
	async switchToBranch(branchName: string): Promise<void> {
		this.previousBranch = await this.getBranchName();
		const { stderr, exitCode } = await execCommand(`git switch -c ${branchName}`);
		if (exitCode > 0 && stderr?.includes('already exists')) {
			logger.info(`Branch ${branchName} already exists. Switching to it`);
			const { stdout, stderr, exitCode } = await execCommand(`git switch ${branchName}`);
			if (exitCode > 0) throw new Error(`${stdout}\n${stderr}`);
		}
	}

	@span()
	async pull(): Promise<void> {
		const branchName = await this.getBranchName();
		const { stdout, stderr, exitCode } = await execCommand('git pull');
		if (exitCode > 0) throw new Error(`Error pulling changes for ${branchName}.\n${stdout}\n${stderr}`);
	}

	@span()
	async mergeChangesIntoLatestCommit(files: string[]): Promise<void> {
		const result = await execCommand(`git add ${files.map((file) => `"${file}"`).join(' ')} && git commit --amend --no-edit`);
		failOnError(`Failed to amend current commit with outstanding changes to ${files.join(' ')}`, result);
	}

	// @func()
	@span({ message: 0 })
	async commit(commitMessage: string): Promise<void> {
		const cwd = this.fileSystem.getWorkingDirectory();
		try {
			const sanitizedMessage = commitMessage.replace(/"/g, '\\"');
			const { stderr } = await exec(`git commit -m "${sanitizedMessage}"`, {
				cwd,
			});
			if (stderr.trim().length) {
				throw new Error(stderr);
			}
		} catch (error) {
			logger.error(error);
			throw error;
		}
	}
}
