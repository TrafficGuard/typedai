import * as path from 'node:path';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { EditBlock, RequestedFileEntry, RequestedPackageInstallEntry, RequestedQueryEntry } from '../coderTypes';
import type { ValidationIssue } from '../validators/validationRule';

export interface MetaRequests {
	requestedFiles?: RequestedFileEntry[] | null;
	requestedQueries?: RequestedQueryEntry[] | null;
	requestedPackageInstalls?: RequestedPackageInstallEntry[] | null;
}

// Provides read-only context from the session needed for reflection generation.
export interface SessionContext {
	workingDir: string;
	absFnamesInChat: Set<string>;
}

export function buildValidationReflection(issues: ValidationIssue[]): string {
	let reflectionText = 'There were issues with the file paths or structure of your proposed changes:\n';
	for (const issue of issues) {
		reflectionText += `- File "${issue.file}": ${issue.reason}\n`;
	}
	reflectionText += 'Please correct these issues and resubmit your changes.';
	return reflectionText;
}

export async function buildFailureReflection(failedEdits: EditBlock[], numPassed: number, fs: IFileSystemService, rootPath: string): Promise<string> {
	const numFailed = failedEdits.length;
	const blocks = numFailed === 1 ? 'block' : 'blocks';
	let report = `# ${numFailed} SEARCH/REPLACE ${blocks} failed to match!\n`;

	for (const edit of failedEdits) {
		report += `\n## SearchReplaceNoExactMatch: This SEARCH block failed to exactly match lines in ${edit.filePath}\n`;
		report += `<<<<<<< SEARCH\n${edit.originalText}\n=======\n${edit.updatedText}\n>>>>>>> REPLACE\n\n`;

		const absolutePath = path.resolve(rootPath, edit.filePath);
		let content: string | null = null;
		try {
			if (await fs.fileExists(absolutePath)) {
				content = await fs.readFile(absolutePath);
			}
		} catch (e: any) {
			logger.warn(`Error reading file ${absolutePath} during reflection: ${e.message}`);
		}

		if (content) {
			if (edit.updatedText && content.includes(edit.updatedText)) {
				report += `NOTE: The REPLACE lines are already present in ${edit.filePath}. Consider if this block is needed.\n\n`;
			}
		}
	}
	report += 'The SEARCH section must exactly match an existing block of lines including all white space, comments, indentation, etc.\n';
	if (numPassed > 0) {
		const pblocks = numPassed === 1 ? 'block' : 'blocks';
		report += `\n# The other ${numPassed} SEARCH/REPLACE ${pblocks} were applied successfully.\n`;
		report += `Don't re-send them.\nJust reply with fixed versions of the ${blocks} above that failed to match.\n`;
	}
	return report;
}

export function buildMetaRequestReflection(metaRequests: MetaRequests, sessionContext: SessionContext): { reflection: string; addedFiles: string[] } {
	let reflection = '';
	const addedFiles: string[] = [];
	const alreadyPresentFiles: string[] = [];

	if (metaRequests.requestedFiles?.length) {
		for (const requestedFile of metaRequests.requestedFiles) {
			if (!requestedFile.filePath || typeof requestedFile.filePath !== 'string') {
				logger.warn('Invalid file path in request, skipping:', requestedFile);
				continue;
			}
			const absPath = path.resolve(sessionContext.workingDir, requestedFile.filePath);
			if (sessionContext.absFnamesInChat.has(absPath)) {
				alreadyPresentFiles.push(requestedFile.filePath);
			} else {
				addedFiles.push(requestedFile.filePath);
			}
		}

		if (addedFiles.length > 0) {
			reflection += `I have added the ${addedFiles.length} file(s) you requested to the chat: ${addedFiles.join(', ')}. `;
		}
		if (alreadyPresentFiles.length > 0) {
			reflection += `The following file(s) you requested were already in the chat: ${alreadyPresentFiles.join(', ')}. `;
		}
	}

	if (metaRequests.requestedQueries?.length) {
		reflection += `You asked ${metaRequests.requestedQueries.length} quer(y/ies): ${metaRequests.requestedQueries.map((q) => `"${q.query}"`).join(', ')}. `;
	}

	if (metaRequests.requestedPackageInstalls?.length) {
		reflection += `You requested to install ${
			metaRequests.requestedPackageInstalls.length
		} package(s): ${metaRequests.requestedPackageInstalls.map((p) => `"${p.packageName}"`).join(', ')}. `;
	}

	return { reflection, addedFiles };
}

export function buildExternalChangeReflection(changedFiles: string[]): string {
	return `The following file(s) were modified after the edit blocks were generated: ${changedFiles.join(
		', ',
	)}. Their content has been updated in your context. Please regenerate the edits using the updated content.`;
}
