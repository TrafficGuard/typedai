import * as path from 'node:path';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { LLM, LlmMessage } from '#shared/llm/llm.model';
import { messageText, user } from '#shared/llm/llm.model';
import type { ExecCmdOptions, ExecResult } from '#utils/exec';
import { CoderExhaustedAttemptsError } from '../sweErrors';
import type { EditBlock, EditFormat } from './coderTypes';
import { MODEL_EDIT_FORMATS } from './constants';
import { applyEdits } from './editApplier';
import { tryFixSearchBlock } from './fixSearchReplaceBlock';
import type { PromptBuilder } from './promptBuilder';
import type { EditPreparer } from './services/EditPreparer';
import { buildExternalChangeReflection, buildFailureReflection, buildMetaRequestReflection, buildValidationReflection } from './services/reflectionGenerator';
import { processResponse } from './services/responseProcessor';
import type { EditSession } from './state/editSession';
import { validateBlocks } from './validators/compositeValidator';
import type { ValidationRule } from './validators/validationRule';

export interface CoderConfig {
	maxAttempts: number;
}

export class SearchReplaceOrchestrator {
	constructor(
		private config: CoderConfig,
		private llms: AgentLLMs,
		private fs: IFileSystemService,
		private editPreparer: EditPreparer,
		private promptBuilder: PromptBuilder,
		private rules: ValidationRule[],
		private fence: [string, string],
		private execCommand: (command: string, opts?: ExecCmdOptions) => Promise<ExecResult>,
		private lenientWhitespace: boolean,
	) {}

	private getRepoFilePath(rootPath: string, relativePath: string): string {
		return path.resolve(rootPath, relativePath);
	}

	private addReflectionToMessages(session: EditSession, reflectionText: string, currentMessages: LlmMessage[]): void {
		session.addReflection(reflectionText);
		currentMessages.push(user(reflectionText));
		logger.warn({ reflection: reflectionText }, `SearchReplaceOrchestrator: Reflecting to LLM for attempt ${session.attempt}.`);
	}

	public async _diagnoseFailures(failedEdits: EditBlock[], session: EditSession): Promise<{ externallyChangedFiles: string[]; badSearchEdits: EditBlock[] }> {
		const externallyChangedFiles = new Set<string>();
		const badSearchEdits: EditBlock[] = [];

		for (const failedEdit of failedEdits) {
			const snapshot = session.fileContentSnapshots.get(failedEdit.filePath);
			if (snapshot !== undefined) {
				const absPath = this.getRepoFilePath(session.workingDir, failedEdit.filePath);
				let currentContent: string | null = null;
				try {
					currentContent = await this.fs.readFile(absPath);
				} catch {
					currentContent = null; // File deleted
				}

				if (snapshot !== currentContent) {
					externallyChangedFiles.add(failedEdit.filePath);
				} else {
					badSearchEdits.push(failedEdit);
				}
			} else {
				// If there's no snapshot, we can't determine if it was an external change.
				// Treat it as a bad search. This can happen if a new file edit fails, for example.
				badSearchEdits.push(failedEdit);
			}
		}

		return {
			externallyChangedFiles: Array.from(externallyChangedFiles),
			badSearchEdits,
		};
	}

	/**
	 *  • loop (up to maxAttempts):
	 *    • Stage 1: Get Actionable Edits from LLM
	 *       • This includes the "context gathering" sub-loop. The goal of this stage is to exit with a set of editBlocks from the LLM, having already handled any meta-requests for files or queries.
	 *    • Stage 2: Structural Validation
	 *       • Perform cheap, structural pre-checks on the editBlocks.
	 *       • Rule: For an edit, does the file path exist?
	 *       • Rule: For an edit, does this cause the number of duplicate lines in the file to substantially increase? This indicates a common issue where the search block is too small and the replace duplicates the file contents.
	 *       • Rule: Is the file path a module alias? This is a mistake.
	 *       • Rule: Is the file path different from a file its meant to be editing? This is more difficult to detect without false postives.
	 *       • if validation fails:
	 *         • Generate a reflection about the structural issues (e.g., "File path does not exist").
	 *         • continue to the next attempt with a new LLM call.
	 *    • Stage 3: Content Validation and Failure Diagnosis
	 *       • This is the critical stage. We attempt to match all SEARCH blocks against the current content of the files on disk without writing any changes yet.
	 *       • Partition the editBlocks into successfulBlocks and failedBlocks.
	 *       • if failedBlocks is not empty:
	 *         • For each failedBlock, diagnose the cause of failure by comparing the file's current content against the snapshot taken before the LLM call.
	 *           • If the content differs, the cause is an External Change.
	 *           • If the content is the same, the cause is an LLM Hallucination (the SEARCH block was incorrect from the start).
	 *         • Generate a single, precise reflection that combines all diagnoses (e.g., "Block for file_A failed due to external changes. Block for file_B failed because the SEARCH text was not found.").
	 *         • continue to the next attempt with this highly specific feedback.
	 *    • Stage 4: Execute Changes
	 *       • If we reach this stage, successfulBlocks contains all the edits, and we are guaranteed they will apply correctly.
	 *       • if dirtyCommits is enabled: Run handleDirtyCommits now for the files in successfulBlocks. This is the last moment before the edits are written.
	 *       • Apply the successfulBlocks to the files, writing the changes to disk.
	 *    • Stage 5: Finalize
	 *       • if autoCommit is enabled, commit the changes.
	 *       • The loop is terminated successfully.
	 * @param session
	 * @param initialMessages
	 * @param userRequest
	 * @param readOnlyFiles
	 */
	async execute(session: EditSession, initialMessages: LlmMessage[], userRequest: string, readOnlyFiles: string[]): Promise<void> {
		let currentMessages = [...initialMessages];
		let currentFailedEdits: EditBlock[] = [];
		const repoFiles = await this.fs.listFilesRecursively();

		let llm: LLM = this.llms.medium;

		while (session.attempt < this.config.maxAttempts) {
			session.incrementAttempt();
			if (session.attempt === this.config.maxAttempts - 1) llm = this.llms.hard;

			logger.info(`SearchReplaceOrchestrator: Attempt ${session.attempt}/${this.config.maxAttempts}`);

			if (session.isPromptStale()) currentMessages = await this.promptBuilder.build(session, userRequest, readOnlyFiles);

			logger.debug({ messagesLength: currentMessages.length }, 'SearchReplaceOrchestrator: Prompt ready for LLM');

			const llmResponseMsgObj = await llm.generateMessage(currentMessages, {
				id: `SearchReplaceOrchestrator.execute.attempt${session.attempt}`,
				temperature: 0.05,
			});
			currentMessages.push(llmResponseMsgObj);
			const llmResponse = messageText(llmResponseMsgObj);

			const modelId = llm.getModel();
			const sortedModelFormatEntries = Object.entries(MODEL_EDIT_FORMATS).sort(([keyA], [keyB]) => keyB.length - keyA.length);
			const editFormat = sortedModelFormatEntries.find(([key]) => modelId.includes(key))?.[1] ?? 'diff';

			const processedResponse = processResponse(llmResponse, editFormat, this.fence);
			const { editBlocks: parsedBlocks, metaRequests } = processedResponse;

			const hasAnyMetaRequest = Object.values(metaRequests).some((req) => req && req.length > 0);

			if (hasAnyMetaRequest) {
				const { reflection, addedFiles } = buildMetaRequestReflection(metaRequests, {
					workingDir: session.workingDir,
					absFnamesInChat: session.absFnamesInChat as Set<string>,
				});

				addedFiles.forEach((filePath) => {
					const absPath = this.getRepoFilePath(session.workingDir, filePath);
					session.addFileToChat(absPath);
				});

				if (reflection) {
					let reflectionText = reflection;
					if (parsedBlocks.length === 0) {
						reflectionText += 'Please proceed with the edits now that you have the additional context, or ask for more information if needed.';
						this.addReflectionToMessages(session, reflectionText, currentMessages);
						session.markPromptStale();
						continue;
					}
					logger.warn(`LLM made meta-request(s) AND provided edit blocks. Processing edit blocks. Meta-requests: ${reflectionText}`);
				}
			}

			const { valid: validBlocksFromValidation, issues: validationIssues } = await validateBlocks(parsedBlocks, repoFiles, this.rules);
			if (validationIssues.length > 0) {
				const reflection = buildValidationReflection(validationIssues);
				this.addReflectionToMessages(session, reflection, currentMessages);
				continue;
			}

			if (validBlocksFromValidation.length === 0) {
				if (parsedBlocks.length > 0) {
					this.addReflectionToMessages(
						session,
						'All provided edit blocks were invalid. Please correct them or request necessary files/information/packages using the specified formats.',
						currentMessages,
					);
				} else if (!hasAnyMetaRequest) {
					this.addReflectionToMessages(
						session,
						'No edit blocks or actionable requests (files, query, package install) were found in your response. Please provide edits in the S/R block format or request necessary items using the specified formats.',
						currentMessages,
					);
				}
				continue;
			}

			const { validBlocks: editsToApply } = await this.editPreparer.prepare(validBlocksFromValidation, session);

			const blocksForCurrentApplyAttempt = [...editsToApply];

			await this.handleDirtyCommits(session, editsToApply, llm);

			const applierResult = await applyEdits(blocksForCurrentApplyAttempt, {
				fs: this.fs,
				lenientWhitespace: this.lenientWhitespace,
				fence: this.fence,
				rootPath: session.workingDir,
			});
			const appliedInAttempt = applierResult.appliedFilePaths;
			currentFailedEdits = applierResult.failedEdits;

			await this.handleAutoCommit(session, appliedInAttempt, blocksForCurrentApplyAttempt, currentFailedEdits);

			if (currentFailedEdits.length > 0) {
				const { externallyChangedFiles, badSearchEdits } = await this._diagnoseFailures(currentFailedEdits, session);

				if (externallyChangedFiles.length > 0) {
					const reflection = buildExternalChangeReflection(externallyChangedFiles);
					this.addReflectionToMessages(session, reflection, currentMessages);
					session.markPromptStale();
					continue;
				}

				currentFailedEdits = badSearchEdits;

				let fixesMade = 0;
				const initialFailedEditsForThisRound = [...currentFailedEdits];
				const nextRoundFailedEdits: EditBlock[] = [];

				for (const failedEdit of initialFailedEditsForThisRound) {
					const fileContentSnapshot = session.fileContentSnapshots.get(failedEdit.filePath);
					if (fileContentSnapshot && failedEdit.originalText.trim() !== '') {
						const correctedBlock = await tryFixSearchBlock(failedEdit, fileContentSnapshot, llm, this.fence);
						if (correctedBlock) {
							const indexInMasterList = blocksForCurrentApplyAttempt.findIndex(
								(b) => b.filePath === failedEdit.filePath && b.originalText === failedEdit.originalText,
							);
							if (indexInMasterList !== -1) {
								blocksForCurrentApplyAttempt[indexInMasterList] = correctedBlock;
								fixesMade++;
							} else {
								nextRoundFailedEdits.push(failedEdit);
							}
						} else {
							nextRoundFailedEdits.push(failedEdit);
						}
					} else {
						nextRoundFailedEdits.push(failedEdit);
					}
				}

				if (fixesMade > 0) {
					const reappliedResult = await applyEdits(blocksForCurrentApplyAttempt, {
						fs: this.fs,
						lenientWhitespace: this.lenientWhitespace,
						fence: this.fence,
						rootPath: session.workingDir,
					});
					reappliedResult.appliedFilePaths.forEach((p) => appliedInAttempt.add(p));
					currentFailedEdits = reappliedResult.failedEdits;

					if (currentFailedEdits.length === 0) {
						session.recordApplication({ applied: Array.from(appliedInAttempt), failed: [] });
						break;
					}
				} else {
					currentFailedEdits = nextRoundFailedEdits;
				}
			}

			session.recordApplication({ applied: Array.from(appliedInAttempt), failed: currentFailedEdits });

			if (currentFailedEdits.length > 0) {
				const reflection = await buildFailureReflection(currentFailedEdits, session.appliedFiles.size, this.fs, session.workingDir);
				this.addReflectionToMessages(session, reflection, currentMessages);
				continue;
			}

			logger.info({ appliedFiles: Array.from(session.appliedFiles) }, 'SearchReplaceOrchestrator: Edits applied successfully.');
			break;
		}

		if (session.attempt >= this.config.maxAttempts && (session.appliedFiles.size === 0 || currentFailedEdits.length > 0)) {
			logger.error(`SearchReplaceOrchestrator: Maximum attempts (${this.config.maxAttempts}) reached. Failing.`);
			const finalReflection = session.lastReflection || 'Unknown error after max attempts, and not all edits were successfully applied in the final attempt.';
			throw new CoderExhaustedAttemptsError(
				`SearchReplaceOrchestrator failed to apply edits after ${this.config.maxAttempts} attempts.`,
				this.config.maxAttempts,
				finalReflection,
			);
		}
	}

	private async handleAutoCommit(session: EditSession, appliedInAttempt: Set<string>, appliedEdits: EditBlock[], currentFailedEdits: EditBlock[]) {
		if (this.fs.getVcs() && session.autoCommit && !currentFailedEdits.length && appliedInAttempt.size > 0) {
			const vcs = this.fs.getVcs()!;
			const filesToCommit = Array.from(appliedInAttempt);
			// Provide the edit instructions and the diff generated by the LLM to the LLM to generate a commit message.
			const diff = appliedEdits.map((edit) => `# ${edit.filePath}\nSEARCH>>>>>>${edit.originalText}\nREPLACE>>>>>${edit.updatedText}\n<<<<<<<`).join('\n\n');
			const commitMessage = await this.llms.medium.generateText(
				`<requirements>${session.requirements}</requirements>\n\n<diff>${diff}</diff>\n\nGenerate a Git commit message for the changes in this diff. Output only the commit message.`,
				{ id: 'autoCommitMessage', thinking: 'none' },
			);
			try {
				await vcs.addAndCommitFiles(filesToCommit, commitMessage);
				logger.info(`Auto-committed changes for ${filesToCommit.length} files: ${filesToCommit.join(', ')}.`);
			} catch (commitError: any) {
				logger.error({ err: commitError }, 'Auto-commit failed after applying edits.');
			}
		}
	}

	/**
	 * Once we know that the search/replace blocks are all valid and will apply succesfully,
	 * then we can check if any of the files targeted for edit have uncommitted changes.
	 * If so, we can ask the LLM to generate a commit message for the changes and commit them.
	 * @param session The edit session.
	 * @param editsToApply The edit blocks that are about to be applied.
	 * @param llm The LLM to use for generating the commit message.
	 */
	private async handleDirtyCommits(session: EditSession, editsToApply: EditBlock[], llm: LLM) {
		if (!session.dirtyCommits || !this.fs.getVcs()) return;

		const vcs = this.fs.getVcs()!;
		const pathsToCommit = new Set<string>();
		const uniqueFilePaths = new Set(editsToApply.map((b) => b.filePath));

		for (const filePath of uniqueFilePaths) {
			if (session.initiallyDirtyFiles.has(filePath) && (await vcs.isDirty(filePath))) {
				pathsToCommit.add(filePath);
			}
		}

		if (pathsToCommit.size > 0) {
			const dirtyFilesArray = Array.from(pathsToCommit);
			logger.info(`Found uncommitted changes in files targeted for edit: ${dirtyFilesArray.join(', ')}. Attempting dirty commit.`);

			const result: ExecResult = await this.execCommand(`git diff ${dirtyFilesArray.join(' ')}`);
			const diff = result.stdout;
			const dirtyCommitMsg = await llm.generateText(
				`<diff>${diff}</diff>\n\nGenerate a commit message for the changes in this diff. Output only the commit message.`,
				{ id: 'dirtyCommitMessage' },
			);
			await vcs.addAndCommitFiles(dirtyFilesArray, dirtyCommitMsg);
			logger.info(`Successfully committed uncommitted changes for: ${dirtyFilesArray.join(', ')}.`);
		}
	}
}
