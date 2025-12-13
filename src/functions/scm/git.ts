import { agentContext } from '#agent/agentContext';
import { getFileSystem } from '#agent/agentContextUtils';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { arg, execCmd, execCommand, failOnError, formatAnsiWithMarkdownLinks } from '#utils/exec';

import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { Commit, VersionControlSystem } from '#shared/scm/versionControlSystem';

@funcClass(__filename)
export class Git implements VersionControlSystem {
	/** The branch name before calling switchToBranch. This enables getting the diff between the current and previous branch */
	previousBranch: string | undefined;

	constructor(private fileSystem: IFileSystemService = getFileSystem()) {}

	opts() {
		// If we're running a script without an agent context, we want to use the script's filesystem working directory, and not default to the process.cwd() in execCommand
		return {
			workingDirectory: agentContext()?.fileSystem?.getWorkingDirectory() ?? this.fileSystem.getWorkingDirectory(),
		};
	}

	/**
	 * Executes the 'git remote get-url origin' command to find the remote URL.
	 * @returns The git origin URL.
	 */
	async getGitOriginUrl(): Promise<string> {
		const statusResult = await execCommand('git remote get-url origin', this.opts());
		failOnError('Failed to get git origin URL.', statusResult);
		return statusResult.stdout.trim();
	}

	/**
	 * Adds all files which are already tracked by version control to the index and commits.
	 * If there are no changes
	 * @param commitMessage
	 */
	// @func()
	async addAllTrackedAndCommit(commitMessage: string): Promise<void> {
		// If nothing has changed then return
		const execResult = await execCommand('git status --porcelain', this.opts());
		// Check if stdout is empty, indicating no changes.
		// Also ensure the command itself didn't fail (though typically it won't for status).
		if (execResult.exitCode === 0 && execResult.stdout.trim().length === 0) {
			logger.debug('addAllTrackedAndCommit: No changes to commit.');
			return;
		}
		// If execResult.exitCode is not 0, it means 'git status --porcelain' itself failed.
		// This case should ideally be handled, but for now, we'll let it proceed,
		// and subsequent commands will likely fail and throw.
		// A more robust check might be:
		// failOnError('Failed to get git status for addAllTrackedAndCommit', execResult);
		// if (execResult.stdout.trim().length === 0) { ... return ... }

		const { exitCode, stdout, stderr } = await execCommand('git add .');
		if (exitCode > 0) throw new Error(`git add . failed: ${stdout}\n${stderr}`);

		await this.commit(commitMessage);
	}

	async addAndCommitFiles(files: string[], commitMessage: string): Promise<void> {
		if (!files || files.length === 0) {
			logger.debug('addAndCommitFiles: No files provided to commit.');
			return;
		}

		const filesToCheck = files.map((file) => `"${file}"`).join(' ');
		// Check if the specified files have any uncommitted changes
		const statusResult = await execCommand(`git status --porcelain ${filesToCheck}`, this.opts());
		failOnError(`Failed to get git status for files: ${files.join(', ')}`, statusResult);

		if (statusResult.stdout.trim().length === 0) {
			logger.debug(`addAndCommitFiles: No changes to commit in specified files: ${files.join(', ')}.`);
			return;
		}

		const filesToAdd = files.map((file) => `"${file}"`).join(' ');
		const addResult = await execCommand(`git add ${filesToAdd}`, this.opts());
		failOnError(`Failed to add files for commit: ${files.join(', ')}`, addResult);

		// The fix is to execute a specific commit command that targets only the added files.
		const commitResult = await execCommand(`git commit -m ${arg(commitMessage)} -- ${filesToAdd}`, this.opts());
		// Pre-commit hooks may make call lint/commit commands with characters for colours etc
		commitResult.stdout = formatAnsiWithMarkdownLinks(commitResult.stdout);
		failOnError(`Failed to commit changes for files: ${files.join(', ')}`, commitResult);
	}

	async addNote(note: string): Promise<void> {
		try {
			const result = await execCommand(`git notes add -m ${arg(note)} ${await this.getHeadSha()}`);
			failOnError(`Failed to add note: ${note}`, result);
		} catch (error) {
			logger.error(error);
			throw error;
		}
	}

	/**
	 * Get the files added. If no commit argument if provided then it is for the head commit,
	 */
	async getAddedFiles(commitSha?: string): Promise<string[]> {
		if (commitSha !== undefined && commitSha !== null) {
			commitSha = commitSha.trim();
		}
		const { stdout } = await execCommand(`git diff --name-status ${commitSha ?? 'HEAD^'}..HEAD`, this.opts());
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
		const originUrl = await execCommand('git config --get remote.origin.url', this.opts());
		failOnError('Unable to get git origin URL', originUrl);
	}

	async getHeadSha(): Promise<string> {
		const execResult = await execCommand('git rev-parse HEAD', this.opts());
		failOnError('Unable to get current commit sha', execResult);
		return execResult.stdout.trim();
	}

	@span()
	async getBranchName(): Promise<string> {
		const { exitCode, stdout, stderr } = await execCommand('git rev-parse --abbrev-ref HEAD', this.opts());
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
	 * @returns The git diff. Note this could be a large string.
	 */
	@func()
	async getDiff(baseRef?: string): Promise<string> {
		const command: string = baseRef?.length
			? `git --no-pager diff $(git merge-base ${baseRef} HEAD) HEAD`
			: // attempt to guess the source branch and find its merge-base with HEAD
				"git --no-pager diff $(git merge-base HEAD $(git for-each-ref --format='%(refname)' refs/heads/ | grep -v $(git symbolic-ref HEAD))) HEAD";

		const result = await execCommand(command, this.opts());

		// Ensure failOnError handles potential errors from merge-base (if refs don't exist/relate) or diff
		failOnError(`Error getting diff against base '${baseRef}'`, result);
		return result.stdout;
	}

	/**
	 * Gets the diff of all currently staged files against the HEAD commit.
	 * @returns The git diff for staged changes. This could be a large string.
	 */
	@func()
	async getStagedDiff(): Promise<string> {
		const result = await execCommand('git diff --staged', this.opts());
		failOnError('Failed to get staged diff.', result);
		return result.stdout;
	}

	/**
	 * Gets the list of file paths for all currently staged files.
	 * @returns An array of file paths that are staged for the next commit.
	 */
	@func()
	async getStagedFiles(): Promise<string[]> {
		const result = await execCommand('git diff --staged --name-only', this.opts());
		failOnError('Failed to get list of staged files.', result);

		// The output is a newline-separated list of files.
		// We split it into an array and filter out any empty lines.
		return result.stdout
			.trim()
			.split('\n')
			.filter((line) => line.length > 0);
	}

	/**
	 * Creates a new branch, or if it already exists then switches to it
	 * @param branchName
	 * @return if the branch was created, or false if switched to an existing one
	 */
	@span({ branch: 0 })
	async createBranch(branchName: string): Promise<boolean> {
		this.previousBranch = await this.getBranchName();

		const { stdout, stderr, exitCode } = await execCommand(`git branch ${branchName}`, this.opts());
		if (exitCode === 0) {
			return true;
		}
		if (stderr?.includes('already exists')) {
			logger.info(`Branch ${branchName} already exists. Switching to it`);
			await this.switchToBranch(branchName);
			return false;
		}
		throw new Error(`${stdout}\n${stderr}`);
	}

	/**
	 * Switches to a branch, checking if it exists locally or remotely
	 * @param branchName
	 */
	@span({ branch: 0 })
	async switchToBranch(branchName: string): Promise<void> {
		this.previousBranch = await this.getBranchName();

		// First, try to switch to the branch directly. This works if it exists locally, even if it's an "unborn" branch.
		const switchResult = await execCommand(`git switch ${arg(branchName)}`, this.opts());

		if (switchResult.exitCode === 0) {
			logger.info(`Switched to existing local branch ${branchName}`);
			return;
		}

		// If the switch failed, the branch likely doesn't exist locally.
		// Check if it exists on the remote.
		const remoteBranchCheck = await execCommand(`git ls-remote --heads origin ${branchName}`, this.opts());

		if (remoteBranchCheck.exitCode === 0 && remoteBranchCheck.stdout.trim().length > 0) {
			// Branch exists on remote, create a local tracking branch.
			const trackResult = await execCommand(`git switch --track origin/${branchName}`, this.opts());
			failOnError(`Failed to create tracking branch for origin/${branchName}`, trackResult);
			logger.info(`Created local tracking branch ${branchName} from origin/${branchName}`);
			return;
		}

		// Branch doesn't exist locally or remotely, so create a new local branch.
		const createResult = await execCommand(`git switch -c ${arg(branchName)}`, this.opts());
		failOnError(`Failed to create new branch ${branchName}`, createResult);
		logger.info(`Created new local branch ${branchName}`);
	}

	@span()
	async pull(): Promise<void> {
		const branchName = await this.getBranchName();

		// Check if the current branch has tracking information
		const trackingCheck = await execCommand('git rev-parse --abbrev-ref @{upstream}', this.opts());

		if (trackingCheck.exitCode !== 0) {
			// No tracking branch set up
			logger.warn(`Branch ${branchName} has no upstream tracking. Attempting to set up tracking with origin/${branchName}`);

			// Check if the branch exists on remote
			const remoteBranchCheck = await execCommand(`git ls-remote --heads origin ${branchName}`, this.opts());

			if (remoteBranchCheck.exitCode === 0 && remoteBranchCheck.stdout.trim().length > 0) {
				// Remote branch exists, set up tracking
				const setUpstreamResult = await execCommand(`git branch --set-upstream-to=origin/${branchName}`, this.opts());
				failOnError(`Failed to set upstream for ${branchName}`, setUpstreamResult);
				logger.info(`Set upstream tracking for ${branchName} to origin/${branchName}`);
			} else {
				// Remote branch doesn't exist, can't pull
				logger.info(`Branch ${branchName} doesn't exist on remote. Skipping pull.`);
				return;
			}
		}

		// Now pull
		const { stdout, stderr, exitCode } = await execCommand('git pull', this.opts());
		if (exitCode > 0) throw new Error(`Error pulling changes for ${branchName}.\n${stdout}\n${stderr}`);
	}

	@span()
	async mergeChangesIntoLatestCommit(files: string[]): Promise<void> {
		const result = await execCommand(`git add ${files.map((file) => `"${file}"`).join(' ')} && git commit --amend --no-edit`, this.opts());
		failOnError(`Failed to amend current commit with outstanding changes to ${files.join(' ')}`, result);
	}

	/**
	 * Commits the staged changes to the repository
	 * @param commitMessage the commit message
	 */
	@func()
	async commit(commitMessage: string): Promise<void> {
		const cwd = this.fileSystem.getWorkingDirectory();
		try {
			const result = await execCommand(`git commit -m ${arg(commitMessage)}`, this.opts());
			failOnError('Error committing changes to Git', result);
		} catch (error) {
			logger.error(error);
			throw error;
		}
	}

	/**
	 * Gets the details of the most recent commits
	 * @param n the number of commits (defaults to 2)
	 * @returns an array of the commit details
	 */
	@func()
	async getRecentCommits(n = 2): Promise<Array<Commit>> {
		const commits: Array<Commit> = [];

		// Get the last N commit hashes
		const getCommitsCmd = `git log -n ${n} --pretty=format:"%H"`;
		const commitsResult = await execCommand(getCommitsCmd, this.opts());
		failOnError('Failed to get recent commits', commitsResult);

		const commitHashes = commitsResult.stdout.split('\n');

		for (const hash of commitHashes) {
			// Get commit details
			const commitDetailsCmd = `git show -s --format="%s%n%n%b" ${hash}`;
			const detailsResult = await execCommand(commitDetailsCmd, this.opts());
			failOnError(`Failed to get details for commit ${hash}`, detailsResult);

			const [title, ...descriptionLines] = detailsResult.stdout.split('\n');
			const description = descriptionLines.join('\n').trim();

			// Get commit diffs
			const diffCmd = `git show ${hash} --name-only --pretty=format:""`;
			const diffResult = await execCommand(diffCmd, this.opts());
			failOnError(`Failed to get diffs for commit ${hash}`, diffResult);

			const changedFiles = diffResult.stdout.split('\n').filter((file) => file.trim() !== '');
			const diffs = new Map<string, string>();

			for (const file of changedFiles) {
				const fileContentCmd = `git show ${hash}:${file}`;
				const fileContentResult = await execCommand(fileContentCmd, this.opts());

				if (fileContentResult.exitCode === 0) {
					diffs.set(file, fileContentResult.stdout);
				} else {
					console.warn(`Failed to get content for file ${file} in commit ${hash}`);
				}
			}

			commits.push({ title: title!, description, diffs });
		}

		return commits;
	}

	async isDirty(path: string): Promise<boolean> {
		const result = await execCommand(`git status --porcelain "${path}"`, this.opts());
		failOnError(`Error checking if ${path} is dirty`, result);
		return result.stdout.trim().length > 0;
	}

	/**
	 * @returns if the repository has any uncommitted changes.
	 */
	async isRepoDirty(): Promise<boolean> {
		const result = await execCommand('git status --porcelain', this.opts());
		failOnError('Error checking if repository is dirty', result);
		return result.stdout.trim().length > 0;
	}

	async revertFile(filePath: string): Promise<void> {
		const { exitCode, stdout, stderr } = await execCommand(`git restore "${filePath}"`, this.opts());
		if (exitCode > 0) logger.warn(`Error reverting ${filePath}: ${stdout} ${stderr}`);
	}

	async stashChanges(): Promise<void> {
		const { exitCode, stdout, stderr } = await execCommand('git stash -u', this.opts());
		if (exitCode > 0) logger.warn(`Error stashing changes: ${stdout} ${stderr}`);
	}
}
