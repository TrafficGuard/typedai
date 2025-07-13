import * as path from 'node:path';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import type { ExecCmdOptions, ExecResult } from '#utils/exec';
import { execCommand } from '#utils/exec';
import type { EditBlock } from './coderTypes';
import { PromptBuilder } from './promptBuilder';
import { CoderConfig, SearchReplaceOrchestrator } from './searchReplaceOrchestrator';
import { EDIT_BLOCK_PROMPTS } from './searchReplacePrompts';
import { EditPreparer } from './services/editPreparer';
import { EditSession } from './state/editSession';
import { ModuleAliasRule } from './validators/moduleAliasRule';
import { PathExistsRule } from './validators/pathExistsRule';
import type { ValidationRule } from './validators/validationRule';

const MAX_ATTEMPTS = 5;
const DEFAULT_FENCE_OPEN = '````';
const DEFAULT_FENCE_CLOSE = '````';
const DEFAULT_LENIENT_WHITESPACE = true;

@funcClass(__filename)
export class SearchReplaceCoder {
	private vcs: VersionControlSystem | null;
	public orchestrator: SearchReplaceOrchestrator;
	private promptBuilder: PromptBuilder;
	private rules: ValidationRule[];

	constructor(
		private llms: AgentLLMs,
		private fs: IFileSystemService,
		private execCommandFn: (command: string, opts?: ExecCmdOptions) => Promise<ExecResult> = execCommand,
	) {
		this.rules = [new PathExistsRule(), new ModuleAliasRule()];
		this.vcs = this.fs.getVcsRoot() ? this.fs.getVcs() : null;
		const fence: [string, string] = [DEFAULT_FENCE_OPEN, DEFAULT_FENCE_CLOSE];

		const language = 'TypeScript';
		const renameFilesReminder = 'To rename files which have been added to the chat, use shell commands at the end of your response.';
		const overeagerPromptContent = EDIT_BLOCK_PROMPTS.overeager_prompt;
		const finalRemindersText = `${renameFilesReminder}\n\n${overeagerPromptContent}`;
		const quadBacktickReminderText = 'IMPORTANT: Use *quadruple* backticks ```` as fences, not triple backticks!\n';
		const mainSystemContent = EDIT_BLOCK_PROMPTS.main_system.replace('{language}', language).replace('{final_reminders}', finalRemindersText);
		const systemReminderContentForPrompt = EDIT_BLOCK_PROMPTS.system_reminder
			.replace(/{fence_0}/g, fence[0])
			.replace(/{fence_1}/g, fence[1])
			.replace('{quad_backtick_reminder}', quadBacktickReminderText)
			.replace('{final_reminders}', finalRemindersText);
		const precomputedSystemMessage = `${mainSystemContent}\n\n${systemReminderContentForPrompt}`;
		const precomputedExampleMessages = EDIT_BLOCK_PROMPTS.example_messages_template.map((msgTemplate) => ({
			role: msgTemplate.role as 'system' | 'user' | 'assistant',
			content: msgTemplate.content.replace(/{fence_0}/g, fence[0]).replace(/{fence_1}/g, fence[1]),
		}));

		this.promptBuilder = new PromptBuilder(this.fs, fence, precomputedSystemMessage, precomputedExampleMessages, systemReminderContentForPrompt);
		const editPreparer = new EditPreparer(this.fs, this.vcs, fence);
		const config: CoderConfig = { maxAttempts: MAX_ATTEMPTS };

		this.orchestrator = new SearchReplaceOrchestrator(
			config,
			this.llms,
			this.fs,
			editPreparer,
			this.promptBuilder,
			this.rules,
			fence,
			this.execCommandFn,
			DEFAULT_LENIENT_WHITESPACE,
		);
	}

	/**
	 * FOR TESTING PURPOSES. This method likely supports a legacy test suite.
	 * It diagnoses failures and is expected by tests to return only the externally changed files.
	 */
	public async diagnoseFailures(failedEdits: EditBlock[], session: EditSession): Promise<string[]> {
		const { externallyChangedFiles } = await this.orchestrator._diagnoseFailures(failedEdits, session);
		return externallyChangedFiles;
	}

	private getRepoFilePath(rootPath: string, relativePath: string): string {
		return path.resolve(rootPath, relativePath);
	}

	private getRelativeFilePath(rootPath: string, absolutePath: string): string {
		return path.relative(rootPath, absolutePath);
	}

	/**
	 * Initializes session context related to files, such as which files are in chat
	 * and which of those were initially dirty.
	 */
	private async _initializeSessionContext(session: EditSession, filesToEdit: string[]): Promise<void> {
		const absFnamesInChat = new Set<string>();
		filesToEdit.forEach((relPath) => absFnamesInChat.add(this.getRepoFilePath(session.workingDir, relPath)));

		const initiallyDirtyFiles = new Set<string>();
		if (this.vcs) {
			for (const absPath of absFnamesInChat) {
				const relPath = this.getRelativeFilePath(session.workingDir, absPath);
				if (await this.vcs.isDirty(relPath)) {
					initiallyDirtyFiles.add(relPath);
					logger.info(`File ${relPath} was dirty before editing session started.`);
				}
			}
		}
		session.initializeFileContext(absFnamesInChat, initiallyDirtyFiles);
	}

	/**
	 * Makes the changes to the project files to meet the task requirements using search/replace blocks.
	 * Max attempts for the LLM to generate valid and applicable edits is 5.
	 * @param requirements The complete task requirements with all supporting documentation and code samples.
	 * @param filesToEdit Relative paths of files that can be edited. These will be included in the chat context.
	 * @param readOnlyFiles Relative paths of files to be used as read-only context.
	 * @param autoCommit Whether to commit the changes automatically after applying them.
	 * @param dirtyCommits If files which have uncommitted changes should be committed before applying changes.
	 */
	@func()
	async editFilesToMeetRequirements(
		requirements: string,
		filesToEdit: string[],
		readOnlyFiles: string[],
		autoCommit = true,
		dirtyCommits = true,
	): Promise<void> {
		const rootPath = this.fs.getWorkingDirectory();
		const session = new EditSession(rootPath, requirements, autoCommit, dirtyCommits);

		await this._initializeSessionContext(session, filesToEdit);

		const initialMessages = await this.promptBuilder.build(session, requirements, readOnlyFiles);

		await this.orchestrator.execute(session, initialMessages, requirements, readOnlyFiles);
	}
}
