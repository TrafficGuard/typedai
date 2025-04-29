/**
 * Version control system
 */
export interface VersionControlSystem {
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
	getDiff(baseRef?: string): Promise<string>;

	/**
	 * Creates a new branch, or if it already exists then switches to it
	 * @param branchName
	 * @return if the branch was created, or false if switched to an existing one
	 */
	createBranch(branchName: string): Promise<boolean>;

	switchToBranch(branchName: string): Promise<void>;

	/** Pull the changes from the remote/origin server for the current branch */
	pull(): Promise<void>;

	/** Gets the current branch name */
	getBranchName(): Promise<string>;

	/** @return the SHA value for the HEAD commit */
	getHeadSha(): Promise<string>;

	/**
	 * Adds all files which are already tracked by version control to the index and commits
	 * @param commitMessage
	 */
	addAllTrackedAndCommit(commitMessage: string): Promise<void>;

	/**
	 * Merges the changes in specific files into the latest commit.
	 * This is useful for merging lint fixes and compiles fixes into the current commit, so that commit should build.
	 */
	mergeChangesIntoLatestCommit(files: string[]): Promise<void>;

	commit(commitMessage: string): Promise<void>;

	/**
	 * Gets the filenames which were added in the most recent commit
	 * @param commitSha The commit to search back to, otherwise is for the HEAD commit.
	 * @return the filenames which were added
	 */
	getAddedFiles(commitSha?: string): Promise<string[]>;
}
