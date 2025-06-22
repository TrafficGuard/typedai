import * as path from 'node:path';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { LLM, LlmMessage } from '#shared/llm/llm.model';
import { messageText, user } from '#shared/llm/llm.model';
import { CoderExhaustedAttemptsError } from '../sweErrors';
import type { PromptBuilder } from './PromptBuilder';
import type { EditBlock, EditFormat } from './coderTypes';
import { MODEL_EDIT_FORMATS } from './constants';
import type { EditApplier } from './editApplier';
import { tryFixSearchBlock } from './fixSearchReplaceBlock';
import type { EditPreparer } from './services/EditPreparer';
import type { ReflectionGenerator } from './services/ReflectionGenerator';
import type { ResponseProcessor } from './services/ResponseProcessor';
import type { EditSession } from './state/EditSession';
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
		private responseProcessor: ResponseProcessor,
		private editPreparer: EditPreparer,
		private reflectionGenerator: ReflectionGenerator,
		private promptBuilder: PromptBuilder,
		private editApplier: EditApplier,
		private rules: ValidationRule[],
	) {}

	private getRepoFilePath(rootPath: string, relativePath: string): string {
		return path.resolve(rootPath, relativePath);
	}

	private addReflectionToMessages(session: EditSession, reflectionText: string, currentMessages: LlmMessage[]): void {
		session.addReflection(reflectionText);
		currentMessages.push(user(reflectionText));
		logger.warn({ reflection: reflectionText }, `SearchReplaceOrchestrator: Reflecting to LLM for attempt ${session.attempt}.`);
	}

	async execute(session: EditSession, initialMessages: LlmMessage[], userRequest: string, readOnlyFiles: string[]): Promise<void> {
		let currentMessages = [...initialMessages];
		let currentFailedEdits: EditBlock[] = [];
		const repoFiles = await this.fs.listFilesRecursively();

		let llm: LLM = this.llms.medium;

		while (session.attempt < this.config.maxAttempts) {
			session.incrementAttempt();
			if (session.attempt === this.config.maxAttempts - 1) llm = this.llms.hard;

			logger.info(`SearchReplaceOrchestrator: Attempt ${session.attempt}/${this.config.maxAttempts}`);

			if (session.isPromptStale()) {
				currentMessages = await this.promptBuilder.build(session, userRequest, readOnlyFiles);
				session.markPromptBuilt();
			}
			logger.debug({ messagesLength: currentMessages.length }, 'SearchReplaceOrchestrator: Prompt ready for LLM');

			const llmResponseMsgObj = await llm.generateMessage(currentMessages, {
				id: `SearchReplaceOrchestrator.execute.attempt${session.attempt}`,
				temperature: 0.05,
			});
			currentMessages.push(llmResponseMsgObj);
			const llmResponse = messageText(llmResponseMsgObj);

			const modelId = llm.getModel();
			const sortedModelFormatEntries = Object.entries(MODEL_EDIT_FORMATS).sort(([keyA], [keyB]) => keyB.length - keyA.length);
			const editFormat: EditFormat = sortedModelFormatEntries.find(([key]) => modelId.includes(key))?.[1] ?? 'diff';
			this.responseProcessor.editFormat = editFormat;

			const processedResponse = this.responseProcessor.process(llmResponse);
			const { editBlocks: parsedBlocks, metaRequests } = processedResponse;

			const hasAnyMetaRequest = Object.values(metaRequests).some((req) => req && req.length > 0);

			if (hasAnyMetaRequest) {
				const { reflection, addedFiles } = this.reflectionGenerator.buildMetaRequestReflection(metaRequests, {
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
				const reflection = this.reflectionGenerator.buildValidationReflection(validationIssues);
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

			const {
				validBlocks: editsToApply,
				dirtyFiles: pathsToDirtyCommit,
				externalChanges,
			} = await this.editPreparer.prepare(validBlocksFromValidation, session);

			if (externalChanges.length > 0) {
				const reflection = this.reflectionGenerator.buildExternalChangeReflection(externalChanges);
				this.addReflectionToMessages(session, reflection, currentMessages);
				session.markPromptStale();
				continue;
			}

			const blocksForCurrentApplyAttempt = [...editsToApply];

			if (session.dirtyCommits && this.fs.getVcs() && pathsToDirtyCommit.size > 0) {
				const vcs = this.fs.getVcs()!;
				const dirtyFilesArray = Array.from(pathsToDirtyCommit);
				logger.info(`Found uncommitted changes in files targeted for edit: ${dirtyFilesArray.join(', ')}. Attempting dirty commit.`);
				try {
					const dirtyCommitMsg = 'Aider: Committing uncommitted changes in targeted files before applying LLM edits';
					await vcs.addAndCommitFiles(dirtyFilesArray, dirtyCommitMsg);
					logger.info(`Successfully committed uncommitted changes for: ${dirtyFilesArray.join(', ')}.`);
				} catch (commitError: any) {
					logger.error({ err: commitError, files: dirtyFilesArray }, `Dirty commit failed for files: ${dirtyFilesArray.join(', ')}.`);
					this.addReflectionToMessages(
						session,
						`Failed to commit uncommitted changes for ${dirtyFilesArray.join(', ')}: ${commitError.message}. Please resolve this manually or allow proceeding without committing them.`,
						currentMessages,
					);
					continue;
				}
			}

			this.editApplier.configure(session.workingDir, session.absFnamesInChat, session.autoCommit, false);
			const applierResult = await this.editApplier.apply(blocksForCurrentApplyAttempt);
			const appliedInAttempt = applierResult.appliedFilePaths;
			currentFailedEdits = applierResult.failedEdits;

			if (currentFailedEdits.length > 0) {
				let fixesMade = 0;
				const initialFailedEditsForThisRound = [...currentFailedEdits];
				const nextRoundFailedEdits: EditBlock[] = [];

				for (const failedEdit of initialFailedEditsForThisRound) {
					const fileContentSnapshot = session.fileContentSnapshots.get(failedEdit.filePath);
					if (fileContentSnapshot && failedEdit.originalText.trim() !== '') {
						const correctedBlock = await tryFixSearchBlock(failedEdit, fileContentSnapshot, llm, this.responseProcessor.getFence());
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
					const reappliedResult = await this.editApplier.apply(blocksForCurrentApplyAttempt);
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
				const reflection = await this.reflectionGenerator.buildFailureReflection(currentFailedEdits, session.appliedFiles.size, this.fs, session.workingDir);
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
}
