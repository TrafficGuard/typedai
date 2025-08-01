export interface Commit {
	title: string;
	description: string;
	diffs: Map<string, string>;
}

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
	 * Executes the 'git remote get-url origin' command to find the remote URL.
	 * @returns The git origin URL.
	 */
	getGitOriginUrl(): Promise<string>;

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

	/** Add and commit a specific list of files. */
	addAndCommitFiles(files: string[], commitMessage: string): Promise<void>;

	/** Add a note to the head commit */
	addNote(note: string): Promise<void>;

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

	/**
	 * Gets the details of the most recent commits
	 * @param n the number of commits (defaults to 2)
	 * @returns an array of the commit details
	 */
	getRecentCommits(n?: number): Promise<Array<Commit>>;

	/**
	 * @param path full file path
	 * @returns if the file has uncommitted changes.
	 */
	isDirty(path: string): Promise<boolean>;

	/**
	 * @returns if the repository has any uncommitted changes.
	 */
	isRepoDirty(): Promise<boolean>;

	/**
	 * @returns
	 */
	stashChanges(): Promise<void>;

	/**
	 * Revert uncommitted changes to a file
	 * @param filePath
	 */
	revertFile(filePath: string): Promise<void>;
}
