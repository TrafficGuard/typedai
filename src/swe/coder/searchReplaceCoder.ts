import * as path from 'node:path';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import type { RequestedFileEntry, RequestedPackageInstallEntry, RequestedQueryEntry } from './coderTypes';
import { CoderConfig, SearchReplaceOrchestrator } from './SearchReplaceOrchestrator';
import { EditApplier } from './editApplier';
import { PromptBuilder } from './PromptBuilder';
import { EDIT_BLOCK_PROMPTS } from './searchReplacePrompts';
import { EditPreparer } from './services/EditPreparer';
import { ReflectionGenerator } from './services/ReflectionGenerator';
import { ResponseProcessor } from './services/ResponseProcessor';
import { EditSession } from './state/EditSession';
import { ModuleAliasRule } from './validators/moduleAliasRule';
import { PathExistsRule } from './validators/pathExistsRule';
import type { ValidationRule } from './validators/validationRule';

const MAX_ATTEMPTS = 5;
const DEFAULT_FENCE_OPEN = '````';
const DEFAULT_FENCE_CLOSE = '````';
const DEFAULT_LENIENT_WHITESPACE = true;

// Helper function to parse file requests from LLM response
export function parseAddFilesRequest(responseText: string): RequestedFileEntry[] | null {
	if (!responseText) return null;
	const match = responseText.match(/<add-files-json>([\s\S]*?)<\/add-files-json>/);
	if (!match || !match[1]) {
		return null;
	}

	const jsonString = match[1];
	try {
		const parsed = JSON.parse(jsonString);
		if (parsed && Array.isArray(parsed.files)) {
			const requestedFiles: RequestedFileEntry[] = [];
			for (const item of parsed.files) {
				if (typeof item.filePath === 'string' && typeof item.reason === 'string') {
					requestedFiles.push({ filePath: item.filePath, reason: item.reason });
				} else {
					logger.warn('Invalid item in files array for add-files-json', { item });
					return null; // Strict parsing: if one item is bad, reject all
				}
			}
			return requestedFiles.length > 0 ? requestedFiles : null;
		}
		logger.warn('Invalid structure for add-files-json content', { jsonString });
		return null;
	} catch (error) {
		logger.error({ err: error }, 'Failed to parse JSON from add-files-json block');
		return null;
	}
}

// New helper function to parse query requests
export function parseAskQueryRequest(responseText: string): RequestedQueryEntry[] | null {
	if (!responseText) return null;
	const matches = Array.from(responseText.matchAll(/<ask-query>([\s\S]*?)<\/ask-query>/g));
	if (!matches.length) return null;

	const requestedQueries: RequestedQueryEntry[] = [];
	for (const match of matches) {
		if (match[1]) {
			requestedQueries.push({ query: match[1].trim() });
		}
	}
	return requestedQueries.length > 0 ? requestedQueries : null;
}

// New helper function to parse package install requests
export function parseInstallPackageRequest(responseText: string): RequestedPackageInstallEntry[] | null {
	if (!responseText) return null;
	const match = responseText.match(/<install-packages-json>([\s\S]*?)<\/install-packages-json>/);
	if (!match || !match[1]) {
		return null;
	}

	const jsonString = match[1];
	try {
		const parsed = JSON.parse(jsonString);
		if (parsed && Array.isArray(parsed.packages)) {
			const requestedPackages: RequestedPackageInstallEntry[] = [];
			for (const item of parsed.packages) {
				if (typeof item.packageName === 'string' && typeof item.reason === 'string') {
					requestedPackages.push({ packageName: item.packageName, reason: item.reason });
				} else {
					logger.warn('Invalid item in packages array for install-packages-json', { item });
					return null; // Strict parsing
				}
			}
			return requestedPackages.length > 0 ? requestedPackages : null;
		}
		logger.warn('Invalid structure for install-packages-json content', { jsonString });
		return null;
	} catch (error) {
		logger.error({ err: error }, 'Failed to parse JSON from install-packages-json block');
		return null;
	}
}

@funcClass(__filename)
export class SearchReplaceCoder {
	private vcs: VersionControlSystem | null;
	private orchestrator: SearchReplaceOrchestrator;
	private promptBuilder: PromptBuilder;
	private rules: ValidationRule[];

	constructor(
		private llms: AgentLLMs,
		private fs: IFileSystemService,
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
		const responseProcessor = new ResponseProcessor(fence, 'diff');
		const editPreparer = new EditPreparer(this.fs, this.vcs, fence);
		const reflectionGenerator = new ReflectionGenerator();
		const editApplier = new EditApplier(this.fs, this.vcs, DEFAULT_LENIENT_WHITESPACE, fence);
		const config: CoderConfig = { maxAttempts: MAX_ATTEMPTS };

		this.orchestrator = new SearchReplaceOrchestrator(
			config,
			this.llms,
			this.fs,
			responseProcessor,
			editPreparer,
			reflectionGenerator,
			this.promptBuilder,
			editApplier,
			this.rules,
		);
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
		session.markPromptBuilt();

		await this.orchestrator.execute(session, initialMessages, requirements, readOnlyFiles);
	}
}
