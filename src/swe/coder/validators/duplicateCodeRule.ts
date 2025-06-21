import { getFileSystem } from '#agent/agentContextLocalStorage';
import type { EditBlock } from '../coderTypes';
import type { ValidationIssue, ValidationRule } from './validationRule';

// Create a function to remove the duplicate code counting the duplicate lines
// which takes the file contents as a string and returns the number of duplicate lines
function countDuplicateLines(fileContents: string): number {
	const lineCounts = new Map<string, number>();

	const nonBlankLines = fileContents.split('\n').filter((line) => line.trim() !== '');
	// Ignore lines with only a single character like a closing bracket "}"
	const nonSingleCharLines = nonBlankLines.filter((line) => line.length > 1);

	for (let line of nonSingleCharLines) {
		line = line.trim(); // Trim whitespace from each line to catch functionally duplicate but stylistically different lines.
		if (lineCounts.has(line)) {
			lineCounts.set(line, lineCounts.get(line)! + 1);
		} else {
			lineCounts.set(line, 1);
		}
	}
	// Subtract 1 from each count to only count the duplicate lines
	const duplicateLineCount = [...lineCounts.values()].map((count) => count - 1).reduce((a: number, b: number) => a + b, 0);
	return duplicateLineCount;
}

/**
 * Sometimes the coder will generate a search/replace block which writes duplicate code without selecting the the old code in search block to replace.
 * This results in a lot of duplicate lines of code.
 * We need to count the number of duplicate lines in a file before and after applying the edit block.
 * If the dupliate lines significantly increases then its an error
 */
export class DuplicateCodeRule implements ValidationRule {
	readonly name = 'DuplicateCodeRule';

	async check(block: EditBlock): Promise<ValidationIssue | null> {
		if (block.updatedText === '') return null;

		// Load the original file from the file system
		const fss = getFileSystem();
		const originalFile = await fss.readFile(block.filePath);

		const originalNonBlankLines = originalFile.split('\n').filter((line) => line.trim() !== '');
		const originalDuplicateLines = countDuplicateLines(originalNonBlankLines.join('\n'));
		const originalDuplicatePercentage = originalDuplicateLines / originalNonBlankLines.length;

		// Apply the edit block
		const updatedFile = originalFile.replace(block.originalText, block.updatedText);
		// Count the number of duplicate lines with edits applied
		const updatedNonBlankLines = updatedFile.split('\n').filter((line) => line.trim() !== '');
		const updatedDuplicateLines = countDuplicateLines(updatedNonBlankLines.join('\n'));
		const updatedDuplicatePercentage = updatedDuplicateLines / updatedNonBlankLines.length;

		const duplicatePercentageIncrease = updatedDuplicatePercentage - originalDuplicatePercentage;

		// if (duplicatePercentageIncrease > 0.1) {
		//     return {
		//         file: block.filePath,
		//         reason: `Duplicate lines found: "${duplicatePercentageIncrease}".`,
		//     };
		// }
		// Lets think through some good heurisits for detecting a bad edit block
		// 1. If the duplicate percentage increase is greater than 0.1
		// 2. If the duplicate percentage increase is greater than 0.1 and the file is less than 100 lines
		// 3. If the duplicate percentage increase is greater than 0.1 and the file is less than 100 lines and the duplicate percentage is greater than 0.1
		// 4. If the duplicate percentage increase is greater than 0.1 and the file is less than 100 lines and the duplicate percentage is greater than 0.1 and the file is less than 100 lines
		// 5. If the duplicate percentage increase is greater than 0.1 and the file is less than 100 lines and the duplicate percentage is greater than 0.1 and the file is less than 100 lines and the duplicate percentage increase is greater than 0.1
		// Evaluate the pros/cons of each options
		// Option 1 is the most simple but may miss some cases
		// Option 2 is more strict but may false positive
		// Option 3 is more strict but may false positive
		// Option 4 is more strict but may false positive
		// Option 5 is the most strict but may false positive

		return null;
	}
}
