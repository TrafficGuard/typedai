import crypto from 'node:crypto';
import * as micromatch from 'micromatch';
import { llms } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { type CodeReviewConfig, type CodeReviewResult, type CodeReviewTask, codeReviewToXml } from '#swe/codeReview/codeReviewModel';

export function getStartingLineNumber(diff: string): number {
	diff = diff.slice(diff.indexOf('+'));
	diff = diff.slice(0, diff.indexOf(','));
	return Number.parseInt(diff);
}

export function getBlankLineCommenter(fileName: string): (lineNumber: number) => string {
	const extension = fileName.split('.').pop();

	switch (extension) {
		case 'js':
		case 'ts':
		case 'java':
		case 'c':
		case 'cpp':
		case 'cs':
		case 'css':
		case 'php':
		case 'swift':
		case 'm': // Objective-C
		case 'go':
		case 'kt': // Kotlin
		case 'kts': // Kotlin script
		case 'groovy':
		case 'scala':
		case 'dart':
			return (lineNumber) => `// ${lineNumber}`;
		case 'py':
		case 'sh':
		case 'pl': // Perl
		case 'rb':
		case 'yaml':
		case 'yml':
		case 'tf':
		case 'r':
			return (lineNumber) => `# ${lineNumber}`;
		case 'html':
		case 'xml':
		case 'jsx':
			return (lineNumber) => `<!-- ${lineNumber} -->`;
		case 'sql':
			return (lineNumber) => `-- ${lineNumber}`;
		case 'ini':
			return (lineNumber) => `; ${lineNumber}`;
		case 'hs': // Haskell
		case 'lsp': // Lisp
		case 'scm': // Scheme
			return (lineNumber) => `-- ${lineNumber}`;
		default:
			// No line number comment if file type is unrecognized
			return (lineNumber) => '';
	}
}

/** Generate fingerprint for caching reviews */
export function generateReviewTaskFingerprint(filePath: string, ruleId: string, diffContents: string): string {
	const data = [`file:${filePath}`, `rule:${ruleId}`, `content:${diffContents}`].join('|');
	return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Determine if a particular code review configuration is valid to perform on a diff
 * @param codeReview
 * @param projectPath
 * @param filePath
 * @param diffContents
 */
export function shouldApplyCodeReview(codeReview: CodeReviewConfig, projectPath: string, filePath: string, diffContents: string): boolean {
	if (!codeReview.enabled) return false;

	// If project paths are provided, then there must be a match
	if (codeReview.projectPaths.length && !micromatch.isMatch(projectPath, codeReview.projectPaths)) {
		console.log(`Project path globs ${codeReview.projectPaths} dont match ${projectPath}`);
		return false;
	}

	const hasMatchingExtension = codeReview.fileExtensions?.include.some((extension) => filePath.endsWith(extension));
	const hasRequiredText = codeReview.requires?.text.some((text) => diffContents.includes(text));

	// File extension and requires text are mandatory fields
	return hasMatchingExtension && hasRequiredText;
}

/**
 * Review a diff from a merge request using the code review guidelines configured by the files in resources/codeReview
 * @param task
 */
export async function reviewDiff(task: CodeReviewTask): Promise<CodeReviewResult> {
	const prompt = `You are an AI software engineer tasked with reviewing code changes for our software development style standards.

Review Configuration:
${codeReviewToXml(task.config)}

Code to Review:
<code-diff>
${task.code}
</code-diff>

Instructions:
1. Based on the provided code review guidelines, analyze the code changes from a diff and identify any potential violations.
2. Consider the overall context and purpose of the code when identifying violations.
3. Comments with a number at the start of lines indicate line numbers. Use these numbers to help determine the starting lineNumber for the review comment. The comment should be on the line after the offending code.
4. Provide the review comments in the following JSON format. If no review violations are found return an empty array for violations.

{
  "thinking": "(thinking and observations about the code and code review config)"
  "violations": [
    {
      "lineNumber": number,
      "comment": "Explanation of the violation and suggestion for valid code in Markdown format"
    }
  ]
}

Response only in JSON format. Do not wrap the JSON in any tags.
`;
	const reviewComments = (await llms().medium.generateJson(prompt, { id: 'Diff code review', temperature: 0.5 })) as {
		violations: Array<{ lineNumber: number; comment: string }>;
	};
	// TODO ensure response is the correct type by setting a schema or checking the results
	return { task, comments: reviewComments.violations };
}

/**
 * Sets the codeWithLinesNums property on the task, which is a copy of the diff with line numbers added as comments
 * @param gitDiff
 * @param newPath
 */
export function addCodeWithLineNumbers(gitDiff: string, newPath: string): { codeWithLineNums: string; code: string } {
	// The first line of the diff has the starting line number e.g. @@ -0,0 +1,76 @@
	let startingLineNumber = getStartingLineNumber(gitDiff);

	const lineCommenter = getBlankLineCommenter(newPath);

	// Transform the diff, so it's not a diff, removing the deleted lines so only the unchanged and new lines remain
	// i.e. the code in the latest commit
	const diffLines: string[] = gitDiff
		.trim()
		.split('\n')
		.filter((line) => !line.startsWith('-'))
		.map((line) => (line.startsWith('+') ? line.slice(1) : line));

	// The current state of the code
	const rawCode = diffLines.slice(1).join('\n');

	startingLineNumber -= 1;
	diffLines[0] = lineCommenter(startingLineNumber);

	// Add lines numbers
	for (let i = 1; i < diffLines.length; i++) {
		const line = diffLines[i];
		// Add the line number on blank lines
		if (!line.trim().length) diffLines[i] = lineCommenter(startingLineNumber + i);
		// Could add in a line number at least every 10 lines if the file type supports closing comments i.e. /* */
		// Or add the line numbers at the end of the line in a single line comment
	}

	return {
		code: rawCode,
		codeWithLineNums: diffLines.join('\n'),
	};
}
