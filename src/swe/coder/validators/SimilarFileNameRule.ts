import { stringSimilarity } from 'string-similarity-js';
import type { EditBlock } from '../applySearchReplace';
import type { ValidationRule, ValidationIssue } from './ValidationRule';

const SEP = '/'; // Assuming POSIX-style paths from LLM

export class SimilarFileNameRule implements ValidationRule {
	readonly name = 'SimilarFileNameRule';

	constructor(
		private threshold = 0.9,
		private enabled = false, // Disabled by default as per roadmap
		private checkParentFolderSimilarity = true, // Controls the parent folder + filename check
	) {}

	check(block: EditBlock, repoFiles: string[]): ValidationIssue | null {
		if (repoFiles.includes(block.filePath)) {
			return null; // File already exists, no need for similarity checks for creation
		}

		// Check for similar parent folder and filename (ported from checkEditBlockFilePath)
		if (this.checkParentFolderSimilarity) {
			const editParts = block.filePath.split(SEP);
			if (editParts.length >= 2) {
				const editFileName = editParts[editParts.length - 1];
				const editParentFolder = editParts[editParts.length - 2];

				for (const existingFilePath of repoFiles) {
					const existingFileParts = existingFilePath.split(SEP);
					if (existingFileParts.length >= 2) {
						const existingFileName = existingFileParts[existingFileParts.length - 1];
						const existingParentFolder = existingFileParts[existingFileParts.length - 2];

						if (editFileName === existingFileName && editParentFolder === existingParentFolder) {
							return {
								file: block.filePath,
								reason: `The proposed file path '${block.filePath}' has a filename and parent folder that match an existing file '${existingFilePath}'. Please verify the path.`,
							};
						}
					}
				}
			}
		}

		// Check for string similarity (if enabled)
		if (this.enabled) {
			for (const existingFilePath of repoFiles) {
				if (stringSimilarity(existingFilePath, block.filePath) >= this.threshold) {
					return {
						file: block.filePath,
						reason: `The proposed file path '${block.filePath}' is very similar (similarity >= ${this.threshold}) to an existing file '${existingFilePath}'. Please verify the path.`,
					};
				}
			}
		}

		return null;
	}
}
