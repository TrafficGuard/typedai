import { Git } from '#functions/scm/git';
import { logger } from '#o11y/logger';
import type { CodeReviewConfig } from '#swe/codeReview/codeReviewModel';
import { appContext } from '../../applicationContext';

/**
 * Performs a code review of a local branch
 */
export async function performLocalBranchCodeReview() {
	const git = new Git();

	await checkInvalidBranch();

	const codeReviewService = appContext().codeReviewService;
	const codeReviewConfigs: CodeReviewConfig[] = (await codeReviewService.listCodeReviewConfigs()).filter((config) => config.enabled);

    const allDiffs = await git.getBranchDiff()
}

async function checkInvalidBranch() {
	const branchName = await new Git().getBranchName();
	if (branchName === 'main' || branchName === 'master' || branchName === 'dev' || branchName === 'develop') {
		throw new Error('Reviews should be a on a feature branch');
	}
}

/**
 * Get the project path from the repo origin URL
 */
async function getProjectPath(): Promise<string> {
	return '';
}

export interface DiffInfo {
    filePath: string;
    diff: string;
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
    let currentFilePath: string | null = null;
    let currentDiffLines: string[] = [];
    let captureMode = false; // Indicates if we are past the '---'/'+++' lines and looking for '@@' or content

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            // Finalize the previous file's diff if necessary
            if (currentFilePath !== null && currentDiffLines.length > 0) {
                diffs.push({
                    filePath: currentFilePath,
                    diff: currentDiffLines.join('\n'),
                });
            }

            // Start processing a new file
            // Extract the 'b/' path as the canonical file path
            const pathParts = line.split(' ');
            if (pathParts.length >= 4) {
                // pathParts[3] should be like 'b/src/cli/files.ts'
                currentFilePath = pathParts[3].startsWith('b/') ? pathParts[3].substring(2) : pathParts[3];
            } else {
                // Handle potential malformed diff --git line, though unlikely
                currentFilePath = 'unknown_file';
            }
            currentDiffLines = [];
            captureMode = false; // Reset capture mode for the new file
        } else if (currentFilePath !== null) {
            // Once we hit '---' or '+++', we are in the metadata/diff content section
            // We only want to start *capturing* from the '@@' line onwards.
            if (line.startsWith('---') || line.startsWith('+++')) {
                captureMode = true; // We are now past the 'index' line, ready for '@@'
                continue; // Don't include '---' or '+++' in the captured diff
            }

            if (captureMode) {
                if (line.startsWith('@@')) {
                    // This is the start of the actual diff content we want
                    currentDiffLines.push(line);
                } else if (currentDiffLines.length > 0) {
                    // Only add subsequent lines if we have already started capturing (found '@@')
                    currentDiffLines.push(line);
                }
                // Ignore lines between 'diff --git' and the first '@@' (like 'index ...')
                // Also ignore '---' and '+++' lines themselves.
            }
        }
    }

    // Add the last processed file
    if (currentFilePath !== null && currentDiffLines.length > 0) {
        diffs.push({
            filePath: currentFilePath,
            diff: currentDiffLines.join('\n'),
        });
    }

    return diffs;
}

