import * as path from 'node:path';
import { agentContext } from '#agent/agentContextLocalStorage';
import { buildFileSystemTreePrompt } from '#agent/agentPromptUtils';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { LlmMessage } from '#shared/llm/llm.model';
import { user } from '#shared/llm/llm.model';
import { EDIT_BLOCK_PROMPTS } from '#swe/coder/searchReplacePrompts';
import type { EditSession } from '#swe/coder/state/editSession';

export class PromptBuilder {
	constructor(
		private fs: IFileSystemService,
		private fence: [string, string],
		private precomputedSystemMessage: string,
		private precomputedExampleMessages: LlmMessage[],
		private systemReminderForUserPrompt: string,
	) {}

	private getRepoFilePath(rootPath: string, relativePath: string): string {
		return path.resolve(rootPath, relativePath);
	}

	private getRelativeFilePath(rootPath: string, absolutePath: string): string {
		return path.relative(rootPath, absolutePath);
	}

	async build(session: EditSession, userRequest: string, readOnlyFilesRelativePaths: string[], repoMapContent?: string): Promise<LlmMessage[]> {
		const messages: LlmMessage[] = [];

		messages.push({ role: 'system', content: this.precomputedSystemMessage });
		messages.push(...this.precomputedExampleMessages);

		const agent = agentContext();
		let fileSystemTree: string | undefined;
		if (agent) {
			fileSystemTree = await buildFileSystemTreePrompt();
		}
		fileSystemTree ??= await this.fs.getFileSystemTree();

		messages.push({ role: 'user', content: `Here's all the files in the repository:\n${fileSystemTree}` });
		messages.push({ role: 'assistant', content: 'Ok, thanks.' });

		const formatFileForPrompt = async (relativePath: string): Promise<string> => {
			const absolutePath = this.getRepoFilePath(session.workingDir, relativePath);
			let fileContent: string | null = null;
			try {
				fileContent = await this.fs.readFile(absolutePath);
			} catch (e) {
				logger.warn(`Could not read file ${relativePath} for prompt inclusion or snapshot: ${(e as Error).message}`);
			}

			session.setFileSnapshot(relativePath, fileContent);

			if (fileContent === null) {
				return `${relativePath}\n[Could not read file content]`;
			}
			const lang = path.extname(relativePath).substring(1) || 'text';
			return `${relativePath}\n${this.fence[0]}${lang}\n${fileContent}\n${this.fence[1]}`;
		};

		const currentFilesInChatAbs = session.absFnamesInChat;
		if (currentFilesInChatAbs.size > 0) {
			let filesContentBlock = EDIT_BLOCK_PROMPTS.files_content_prefix;
			const sortedChatFilesRel = Array.from(currentFilesInChatAbs)
				.map((absPath) => this.getRelativeFilePath(session.workingDir, absPath))
				.sort();
			for (const relPath of sortedChatFilesRel) {
				filesContentBlock += `\n\n${await formatFileForPrompt(relPath)}`;
			}
			messages.push({ role: 'user', content: filesContentBlock });
			messages.push({ role: 'assistant', content: EDIT_BLOCK_PROMPTS.files_content_assistant_reply });
		} else {
			messages.push({ role: 'user', content: EDIT_BLOCK_PROMPTS.files_no_full_files });
		}

		if (readOnlyFilesRelativePaths.length > 0) {
			let readOnlyFilesContentBlock = EDIT_BLOCK_PROMPTS.read_only_files_prefix;
			const sortedReadOnlyFilesRel = readOnlyFilesRelativePaths.sort();
			for (const relPath of sortedReadOnlyFilesRel) {
				readOnlyFilesContentBlock += `\n\n${await formatFileForPrompt(relPath)}`;
			}
			messages.push({ role: 'user', content: readOnlyFilesContentBlock });
			messages.push({ role: 'assistant', content: 'Ok, I will treat these files as read-only.' });
		}

		if (repoMapContent) {
			messages.push({ role: 'user', content: `${EDIT_BLOCK_PROMPTS.repo_content_prefix}\n${repoMapContent}` });
			messages.push({ role: 'assistant', content: 'Ok, I will use this repository information for context.' });
		}

		if (session.reflections.length > 0) {
			for (const reflection of session.reflections) {
				messages.push(user(reflection));
			}
		}

		messages.push({ role: 'user', content: `${userRequest}\n\n${this.systemReminderForUserPrompt}` });
		session.markPromptBuilt();
		return messages;
	}
}
