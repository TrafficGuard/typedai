import fs from 'node:fs';
import util from 'util';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { funcClass } from '#functionSchema/functionDecorators';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { execCmd, execCommand, failOnError } from '#utils/exec';
import { VersionControlSystem } from './versionControlSystem';
const exec = util.promisify(require('child_process').exec);

@funcClass(__filename)
export class Git implements VersionControlSystem {
	/** The branch name before calling switchToBranch. This enables getting the diff between the current and previous branch */
	previousBranch: string | undefined;

	constructor(private fileSystem: FileSystemService) {}

	async clone(repoURL: string, commitOrBranch = ''): Promise<void> {
		await fs.promises.mkdir(getFileSystem().getWorkingDirectory(), { recursive: true });
		const { exitCode, stdout, stderr } = await execCommand(`git clone ${repoURL} ${commitOrBranch}`);
		if (exitCode > 0) throw new Error(`${stdout}\n${stderr}`);
	}

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
	 * Returns the diff between the current branch head and the source branch
	 * @param sourceBranch
	 */
	@span({ sourceBranch: 0 })
	async getBranchDiff(sourceBranch: string = this.previousBranch): Promise<string> {
		// git diff $(git merge-base <source-branch> HEAD) HEAD
		if (!sourceBranch) throw new Error('Source branch is required');
		const result = await execCommand(`git --no-pager diff $(git merge-base ${sourceBranch} HEAD) HEAD`);
		failOnError('Error getting branch diff', result);
		return result.stdout;
	}

	/**
	 * Returns the diff between the head commit either the previous commit, or the commit provided by the commitSha argument.
	 * @param commitSha
	 */
	@span()
	async getDiff(commitSha?: string): Promise<string> {
		const result = await execCommand(`git --no-pager diff ${commitSha ?? 'HEAD^'}..HEAD`);
		failOnError('Error getting diff', result);
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
