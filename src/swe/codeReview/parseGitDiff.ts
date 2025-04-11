export interface DiffInfo {
	filePath: string; // The definitive path (old path for deleted, new path otherwise)
	oldPath: string;
	newPath: string;
	diff: string;
	deletedFile: boolean;
	newFile: boolean;
}

/**
 * Parses the output of `git diff` in the unified format.
 * Extracts file paths and the corresponding diff content starting from the hunk header (@@).
 *
 * @param diffOutput The raw string output from `git diff`.
 * @returns An array of objects, each containing the file path and its diff string.
 */
export function parseGitDiff(diffOutput: string): DiffInfo[] {
	const lines = diffOutput.trim().split('\n');
	const diffs: DiffInfo[] = [];
	let currentOldPath: string | null = null;
	let currentNewPath: string | null = null;
	let currentDiffLines: string[] = [];
	let processingHeader = false; // Flag to indicate we are processing header lines (---, +++)

	for (const line of lines) {
		if (line.startsWith('diff --git')) {
			// Finalize the previous file's diff if necessary
			if (currentOldPath !== null && currentNewPath !== null && currentDiffLines.length > 0) {
				const deletedFile = currentNewPath === '/dev/null';
				const newFile = currentOldPath === '/dev/null';
				const filePath = deletedFile ? currentOldPath : currentNewPath; // Use old path if deleted

				// Only add if we have a valid file path and some diff content (starts with @@)
				if (filePath && filePath !== '/dev/null' && currentDiffLines.some((l) => l.startsWith('@@'))) {
					diffs.push({
						filePath,
						oldPath: currentOldPath,
						newPath: currentNewPath,
						diff: currentDiffLines.join('\n'),
						deletedFile,
						newFile,
					});
				}
			}

			// Reset for the new file
			currentOldPath = null;
			currentNewPath = null;
			currentDiffLines = [];
			processingHeader = true; // Start looking for ---/+++ lines

			// Extract paths from the diff --git line itself (less reliable than ---/+++)
			// Example: diff --git a/old/path b/new/path
			// const pathParts = line.split(' ');
			// if (pathParts.length >= 4) {
			//     // Tentatively set paths, prefer ---/+++ lines later
			//     // currentOldPath = pathParts[2].startsWith('a/') ? pathParts[2].substring(2) : pathParts[2];
			//     // currentNewPath = pathParts[3].startsWith('b/') ? pathParts[3].substring(2) : pathParts[3];
			// }
		} else if (processingHeader) {
			if (line.startsWith('---')) {
				currentOldPath = line.substring(4).trim().replace(/^a\//, ''); // Remove '--- a/' prefix
			} else if (line.startsWith('+++')) {
				currentNewPath = line.substring(4).trim().replace(/^b\//, ''); // Remove '+++ b/' prefix
				processingHeader = false; // Done with header lines for this file
			}
			// Ignore other header lines like 'index', 'new file mode', 'deleted file mode'
		} else if (currentOldPath !== null && currentNewPath !== null) {
			// Only capture lines after the header (---, +++) has been processed
			// Start capturing from the first hunk header '@@'
			if (line.startsWith('@@')) {
				currentDiffLines.push(line);
			} else if (currentDiffLines.length > 0) {
				// Capture subsequent lines only if we've already started a hunk
				currentDiffLines.push(line);
			}
		}
	}

	// Add the last processed file
	if (currentOldPath !== null && currentNewPath !== null && currentDiffLines.length > 0) {
		const deletedFile = currentNewPath === '/dev/null';
		const newFile = currentOldPath === '/dev/null';
		const filePath = deletedFile ? currentOldPath : currentNewPath;

		if (filePath && filePath !== '/dev/null' && currentDiffLines.some((l) => l.startsWith('@@'))) {
			diffs.push({
				filePath,
				oldPath: currentOldPath,
				newPath: currentNewPath,
				diff: currentDiffLines.join('\n'),
				deletedFile,
				newFile,
			});
		}
	}

	return diffs;
}
