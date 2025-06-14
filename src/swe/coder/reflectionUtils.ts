import * as path from 'node:path';
import { logger } from '#o11y/logger'; // Added for potential logging within utils if needed
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { EditBlock } from './coderTypes';
import type { ValidationIssue } from './validators/validationRule';

export function buildValidationIssuesReflection(issues: ValidationIssue[]): string {
	let reflectionText = 'There were issues with the file paths or structure of your proposed changes:\n';
	for (const issue of issues) {
		reflectionText += `- File "${issue.file}": ${issue.reason}\n`;
	}
	reflectionText += 'Please correct these issues and resubmit your changes.';
	return reflectionText;
}

export async function buildFailedEditsReflection(
	failedEdits: EditBlock[],
	numPassed: number,
	fs: IFileSystemService,
	rootPath: string, // Equivalent to session.workingDir
): Promise<string> {
	const numFailed = failedEdits.length;
	const blocks = numFailed === 1 ? 'block' : 'blocks';
	let report = `# ${numFailed} SEARCH/REPLACE ${blocks} failed to match!\n`;

	for (const edit of failedEdits) {
		report += `\n## SearchReplaceNoExactMatch: This SEARCH block failed to exactly match lines in ${edit.filePath}\n`;
		report += `<<<<<<< SEARCH\n${edit.originalText}=======\n${edit.updatedText}>>>>>>> REPLACE\n\n`;

		const absolutePath = path.resolve(rootPath, edit.filePath);
		let content: string | null = null;
		// Check if fileExists before readFile to align with original logic's implicit check
		try {
			if (await fs.fileExists(absolutePath)) {
				content = await fs.readFile(absolutePath);
			}
		} catch (e: any) {
			logger.warn(`Error reading file ${absolutePath} during reflection: ${e.message}`);
			// content remains null
		}

		if (content) {
			// TODO: Implement _findSimilarLines if desired for richer feedback (from original Coder)
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
