/**
 * Represents a single SEARCH/REPLACE block for a file edit.
 * This structure is used to track failed edits.
 */
export interface EditBlock {
	filePath: string;
	originalText: string;
	updatedText: string;
}

/**
 * Describes the result of applying a set of edits to the workspace.
 * This is used as input for recording the outcome of an attempt.
 */
export interface ApplicationResult {
	/** A list of file paths that were successfully modified. */
	applied: string[];
	/** A list of edit blocks that could not be applied. */
	failed: EditBlock[];
}

/**
 * Defines the internal state of an edit session. This is not exported
 * as it's an implementation detail of the EditSession class.
 */
interface SessionState {
	/** The current attempt number, starting from 0. */
	attempt: number;
	/** Flag indicating if the prompt for the current attempt has been built. */
	promptBuilt: boolean;
	/** A set of file paths that have been successfully modified during the session. */
	appliedFiles: Set<string>;
	/** A list of edit blocks that failed to apply in the last attempt. */
	failedEdits: EditBlock[];
	/** A history of reflections made by the LLM to correct its course. */
	reflections: string[];
	/** Absolute paths of all files that are part of the chat context. */
	absFnamesInChat: Set<string>;
	/** Relative paths of files that were dirty at the start of the session. */
	initiallyDirtyFiles: Set<string>;
	/** Snapshots of file contents at the time of prompt generation. */
	fileContentSnapshots: Map<string, string | null>;
}

/**
 * Manages the state of a single coding task, including attempts,
 * applied changes, failures, and reflections. It serves as the central
 * state machine for the SWE agent's coding loop.
 */
export class EditSession {
	private _state: SessionState = {
		attempt: 0,
		promptBuilt: false,
		appliedFiles: new Set<string>(),
		failedEdits: [],
		reflections: [],
		absFnamesInChat: new Set<string>(),
		initiallyDirtyFiles: new Set<string>(),
		fileContentSnapshots: new Map<string, string | null>(),
	};

	/**
	 * Creates a new edit session.
	 * @param workingDir The absolute path to the workspace directory.
	 * @param requirements The user's initial requirements for the coding task.
	 */
	constructor(
		public readonly workingDir: string,
		public readonly requirements: string,
	) {}

	/** The current attempt number. */
	get attempt(): number {
		return this._state.attempt;
	}

	/** A read-only set of file paths that have been successfully modified. */
	get appliedFiles(): ReadonlySet<string> {
		return new Set(this._state.appliedFiles);
	}

	/** A read-only array of edits that failed in the last attempt. */
	get failedEdits(): readonly EditBlock[] {
		return [...this._state.failedEdits];
	}

	/** A read-only array of LLM reflections. */
	get reflections(): readonly string[] {
		return [...this._state.reflections];
	}

	/** A read-only set of absolute file paths currently in the chat context. */
	get absFnamesInChat(): ReadonlySet<string> {
		return this._state.absFnamesInChat;
	}

	/** A read-only set of relative file paths that were dirty at session start. */
	get initiallyDirtyFiles(): ReadonlySet<string> {
		return this._state.initiallyDirtyFiles;
	}

	/** A read-only map of file content snapshots. */
	get fileContentSnapshots(): ReadonlyMap<string, string | null> {
		return this._state.fileContentSnapshots;
	}

	/** The most recent reflection, or undefined if there are none. */
	get lastReflection(): string | undefined {
		return this._state.reflections[this._state.reflections.length - 1];
	}

	/**
	 * Increments the attempt counter and resets the prompt-built flag.
	 * This should be called when starting a new attempt after a failure.
	 */
	incrementAttempt(): void {
		this._state.attempt++;
		this._state.promptBuilt = false;
	}

	/**
	 * Records the result of applying edits to the workspace.
	 * @param result The outcome of the edit application process.
	 */
	recordApplication(result: ApplicationResult): void {
		result.applied.forEach((f) => this._state.appliedFiles.add(f));
		this._state.failedEdits = result.failed;
	}

	/**
	 * Adds a reflection to the session's history.
	 * @param reflection The reflection text from the LLM.
	 */
	addReflection(reflection: string): void {
		this._state.reflections.push(reflection);
	}

	/**
	 * Initializes the file-related context for the session.
	 * @param absFnamesInChat A set of absolute file paths to start the chat with.
	 * @param initiallyDirtyFiles A set of relative file paths that are dirty.
	 */
	initializeFileContext(absFnamesInChat: Set<string>, initiallyDirtyFiles: Set<string>): void {
		this._state.absFnamesInChat = absFnamesInChat;
		this._state.initiallyDirtyFiles = initiallyDirtyFiles;
	}

	/**
	 * Adds a file to the chat context.
	 * @param absPath The absolute path of the file to add.
	 */
	addFileToChat(absPath: string): void {
		this._state.absFnamesInChat.add(absPath);
	}

	/**
	 * Stores a snapshot of a file's content.
	 * @param relativePath The relative path of the file.
	 * @param content The content of the file, or null if it couldn't be read.
	 */
	setFileSnapshot(relativePath: string, content: string | null): void {
		this._state.fileContentSnapshots.set(relativePath, content);
	}

	/**
	 * Checks if the prompt for the current attempt needs to be rebuilt.
	 * @returns True if the prompt has not yet been built for this attempt.
	 */
	shouldRebuildPrompt(): boolean {
		return !this._state.promptBuilt;
	}

	/**
	 * Marks the prompt for the current attempt as built.
	 */
	markPromptBuilt(): void {
		this._state.promptBuilt = true;
	}

	/**
	 * Determines if the coding task is complete.
	 * @returns True if the last attempt had no failed edits and at least one file was changed.
	 */
	isComplete(): boolean {
		return this._state.failedEdits.length === 0 && this._state.appliedFiles.size > 0;
	}
}
