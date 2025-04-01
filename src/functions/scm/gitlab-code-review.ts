import crypto from 'node:crypto';
import {
	CommitDiffSchema,
	DiscussionSchema,
	ExpandedMergeRequestSchema,
	Gitlab as GitlabApi,
	MergeRequestDiffSchema,
	MergeRequestDiscussionNotePositionOptions,
	ProjectSchema,
} from '@gitbeaker/rest';
import * as micromatch from 'micromatch';
import { llms } from '#agent/agentContextLocalStorage';
import { MergeRequestFingerprintCache } from '#firestore/firestoreCodeReviewService';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { GitLab, GitLabConfig } from '#functions/scm/gitlab';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { CodeReviewConfig, codeReviewToXml } from '#swe/codeReview/codeReviewModel';
import { functionConfig } from '#user/userService/userContext';
import { allSettledAndFulFilled } from '#utils/async-utils';
import { envVar } from '#utils/env-var';
import { appContext } from '../../applicationContext';
import { cacheRetry } from '../../cache/cacheRetry';
import { SourceControlManagement } from './sourceControlManagement';

/**
 * AI review of a git diff
 */
interface DiffReview {
	mrDiff: MergeRequestDiffSchema;
	/** The code being reviewed from the diff */
	code: string;
	/** Code review comments */
	comments: Array<{ comment: string; lineNumber: number }>;
	/** The code review configuration */
	reviewConfig: CodeReviewConfig;
}

interface ReviewUnit {
	config: CodeReviewConfig;
	diff: MergeRequestDiffSchema;
	// Code string WITH line number comments for the LLM
	codeWithLinesForLLM: string;
	// Hash generated from code WITHOUT line numbers
	codeHashWithoutLines: string;
	// Fingerprint generated using hash WITHOUT line numbers and NO headSha
	fingerprint: string;
}

// Note that the type returned from getProjects is mapped to GitProject
export type GitLabProject = Pick<
	ProjectSchema,
	| 'id'
	| 'name'
	| 'description'
	| 'path_with_namespace'
	| 'http_url_to_repo'
	| 'default_branch'
	| 'archived'
	// | "shared_with_groups"
	| 'visibility'
	| 'owner'
	| 'ci_config_path'
>;

@funcClass(__filename)
export class GitLabCodeReview {
	// @ts-ignore
	_gitlab: GitlabApi;
	_config: GitLabConfig;
	_gitlabSCM: SourceControlManagement;

	private config(): GitLabConfig {
		if (!this._config) {
			const config = functionConfig(GitLab);
			if (!config.token && !envVar('GITLAB_TOKEN')) logger.error('No GitLab token configured on the user or environment');
			this._config = {
				host: config.host || envVar('GITLAB_HOST'),
				token: config.token || envVar('GITLAB_TOKEN'),
				topLevelGroups: (config.topLevelGroups || envVar('GITLAB_GROUPS')).split(',').map((group: string) => group.trim()),
			};
		}
		return this._config;
	}

	// @ts-ignore
	private api(): GitlabApi {
		this._gitlab ??= new GitlabApi({
			host: `https://${this.config().host}`,
			token: this.config().token,
		});
		return this._gitlab;
	}

	private gitlabSCM(): SourceControlManagement {
		this._gitlabSCM ??= new GitLab();
		return this._gitlabSCM;
	}

	@cacheRetry()
	@span()
	async getDiffs(gitlabProjectId: string | number, mergeRequestIId: number): Promise<MergeRequestDiffSchema[]> {
		const diffs = await this.api().MergeRequests.allDiffs(gitlabProjectId, mergeRequestIId, { perPage: 100 });
		if (diffs.length === 100) {
		}
		return diffs;
	}

	@span()
	async reviewMergeRequest(gitlabProjectId: string | number, mergeRequestIId: number): Promise<MergeRequestDiffSchema[]> {
		const mergeRequest: ExpandedMergeRequestSchema = await this.api().MergeRequests.show(gitlabProjectId, mergeRequestIId);
		const diffs: MergeRequestDiffSchema[] = await this.getDiffs(gitlabProjectId, mergeRequestIId);
		const codeReviewService = appContext().codeReviewService;
		const codeReviewConfigs: CodeReviewConfig[] = await codeReviewService.listCodeReviewConfigs();
		const existingComments: DiscussionSchema[] = await this.api().MergeRequestDiscussions.all(gitlabProjectId, mergeRequestIId);

		// --- Load Cache Object ---
		// getMergeRequestReviewCache returns { lastUpdated: number, fingerprints: Set<string> }
		const loadedCacheObject: MergeRequestFingerprintCache = await codeReviewService.getMergeRequestReviewCache(gitlabProjectId, mergeRequestIId);
		// Create a deep clone to work with, especially the Set
		const workingCacheObject: MergeRequestFingerprintCache = {
			lastUpdated: loadedCacheObject.lastUpdated,
			fingerprints: new Set(loadedCacheObject.fingerprints), // Clone the Set
		};
		let cacheNeedsUpdate = false;

		// --- Extract existing violation identifiers (no change) ---
		const BOT_USER_ID = parseInt(process.env.GITLAB_BOT_USER_ID || '0', 10);
		if (BOT_USER_ID === 0) logger.warn('GITLAB_BOT_USER_ID not configured.');
		const existingViolationIdentifiers = new Set<string>();
		for (const discussion of existingComments) {
			if (discussion.notes) {
				for (const note of discussion.notes) {
					if (note.author.id === BOT_USER_ID && note.body) {
						const identifier = extractIdentifier(note.body);
						if (identifier) {
							existingViolationIdentifiers.add(identifier);
						}
					}
				}
			}
		}
		logger.info(`Found ${existingViolationIdentifiers.size} existing violation identifiers from bot.`);

		// --- Determine Project Path (no change) ---
		let projectPath: string;
		if (typeof gitlabProjectId === 'number') {
			try {
				const project = await this.gitlabSCM().getProject(gitlabProjectId);
				projectPath = project.fullPath;
			} catch (error) {
				logger.error({ error, gitlabProjectId }, 'Failed to get project details from ID');
				projectPath = `project_id_${gitlabProjectId}`;
			}
		} else {
			projectPath = gitlabProjectId;
		}
		logger.info(`Reviewing MR "${mergeRequest.title}" in project "${projectPath}" (${mergeRequest.web_url})`);
		logger.debug(`Head SHA: ${mergeRequest.diff_refs?.head_sha}, Base SHA: ${mergeRequest.diff_refs?.base_sha}`);

		const reviewUnitsToProcess: ReviewUnit[] = [];
		const skippedUnits: string[] = [];

		// --- Pre-filter and check cache (IN MEMORY using Set) ---
		for (const diff of diffs) {
			if (diff.deleted_file || !diff.diff || diff.diff.trim() === '') continue;

			for (const codeReview of codeReviewConfigs) {
				if (this.shouldApplyCodeReview(codeReview, diff, projectPath)) {
					let preparedCode: { codeWithLines: string; codeWithoutLines: string };
					try {
						// Get BOTH versions of the code
						preparedCode = this.prepareCodeForReview(diff);
					} catch (e) {
						logger.warn({ error: e, file: diff.new_path }, 'Failed to prepare code for review, skipping.', e);
						continue; // Skip this diff/rule combo if preparation fails
					}
					const { codeWithLines, codeWithoutLines } = preparedCode;

					// Generate hash from code WITHOUT line numbers
					const codeHashWithoutLines = hashString(codeWithoutLines);

					// Generate fingerprint using the correct hash and NO headSha
					const fingerprint = generateReviewUnitFingerprint(
						gitlabProjectId,
						mergeRequestIId,
						// Removed: headSha,
						diff.new_path,
						codeReview.id,
						undefined,
						codeHashWithoutLines, // Use hash without lines
					);

					// Check the IN-MEMORY Set using the fingerprint
					if (workingCacheObject.fingerprints.has(fingerprint)) {
						logger.debug({ fingerprint, file: diff.new_path, rule: codeReview.title }, 'Skipping clean review unit (in-memory cache hit)');
						skippedUnits.push(fingerprint);
					} else {
						// Add to processing list, storing the code WITH lines for the LLM
						reviewUnitsToProcess.push({
							config: codeReview,
							diff,
							codeWithLinesForLLM: codeWithLines, // For LLM
							codeHashWithoutLines: codeHashWithoutLines, // For reference/debugging
							fingerprint: fingerprint, // For caching
						});
					}
				}
			}
		}

		if (!reviewUnitsToProcess.length) {
			logger.info(`No new review units to process. ${skippedUnits.length} units skipped via cache.`);
			return diffs;
		}

		logger.info(`Found ${reviewUnitsToProcess.length} review units needing LLM analysis.`);

		// --- Perform LLM Reviews ---
		const codeReviewActions: Promise<(DiffReview & { fingerprint: string }) | null>[] = reviewUnitsToProcess.map(async (unit) => {
			try {
				// Call the async reviewDiff method for each unit
				const reviewResult: DiffReview | null = await this.reviewDiff(unit.diff, unit.config, unit.codeWithLinesForLLM);

				// If reviewDiff succeeded (returned data, not null)
				if (reviewResult) {
					// Combine the review result with the fingerprint and hash info
					return {
						...reviewResult, // Spread properties from DiffReview (code, comments, mrDiff, reviewConfig)
						fingerprint: unit.fingerprint,
					};
				}
				// reviewDiff returned null (e.g., LLM error, invalid format)
				logger.warn({ fingerprint: unit.fingerprint, file: unit.diff.new_path, rule: unit.config.title }, 'reviewDiff returned null, skipping result.');
				return null; // Propagate null to indicate failure for this unit
			} catch (error) {
				// Catch any unexpected errors during the reviewDiff execution
				logger.error(
					{ error, fingerprint: unit.fingerprint, file: unit.diff.new_path, rule: unit.config.title },
					'Unexpected error during mapping/executing reviewDiff',
				);
				return null; // Indicate failure for this unit
			}
		});

		let codeReviewResults = await allSettledAndFulFilled(codeReviewActions);
		codeReviewResults = codeReviewResults.filter((diffReview) => diffReview !== null);

		// --- Process Results: Post Comments and Update IN-MEMORY Set ---
		for (const reviewResult of codeReviewResults) {
			if (reviewResult.comments && reviewResult.comments.length > 0) {
				// --- Post violation comments (no change needed here) ---
				for (const comment of reviewResult.comments) {
					// Generate violation identifier for deduplication
					const codeLinesAroundViolation = getCodeContext(reviewResult.code, comment.lineNumber, 3);
					const violationContextHash = generateContextHash(
						reviewResult.reviewConfig.id,
						reviewResult.mrDiff.new_path,
						comment.lineNumber,
						codeLinesAroundViolation,
					);
					const violationIdentifier = generateIdentifier(reviewResult.reviewConfig.id, reviewResult.mrDiff.new_path, violationContextHash);
					const hiddenIdentifierTag = `<!-- ${violationIdentifier} -->`;

					// Check if already commented (by this bot, based on identifier)
					if (existingViolationIdentifiers.has(violationIdentifier)) {
						logger.info({ violationIdentifier, file: reviewResult.mrDiff.new_path, line: comment.lineNumber }, 'Skipping duplicate violation comment posting');
						continue;
					}

					logger.info(
						{ comment: comment.comment, lineNumber: comment.lineNumber, file: reviewResult.mrDiff.new_path },
						`Adding review comment for "${reviewResult.reviewConfig.title}"`,
					);

					// Prepare comment position data
					if (!mergeRequest.diff_refs?.base_sha || !mergeRequest.diff_refs?.head_sha || !mergeRequest.diff_refs?.start_sha) {
						logger.warn({ mrId: mergeRequest.id }, 'Cannot create comment position, missing diff_refs on merge request.');
						continue;
					}
					const position: MergeRequestDiscussionNotePositionOptions = {
						baseSha: mergeRequest.diff_refs.base_sha,
						headSha: mergeRequest.diff_refs.head_sha,
						startSha: mergeRequest.diff_refs.start_sha,
						oldPath: reviewResult.mrDiff.old_path,
						newPath: reviewResult.mrDiff.new_path,
						positionType: 'text',
						newLine: comment.lineNumber > 0 ? comment.lineNumber.toString() : undefined,
					};
					Object.keys(position).forEach((key) => position[key] === undefined && delete position[key]);
					const positionOptions = position.newLine ? { position } : undefined;

					// Post comment
					const commentBodyWithIdentifier = `${hiddenIdentifierTag}\n\n${comment.comment}`;
					try {
						await this.api().MergeRequestDiscussions.create(gitlabProjectId, mergeRequestIId, commentBodyWithIdentifier, positionOptions);
						existingViolationIdentifiers.add(violationIdentifier); // Add after successful post
					} catch (e) {
						const message = e.cause?.description || e.message;
						logger.warn(
							{ error: e, comment: comment.comment, lineNumber: comment.lineNumber, positionOptions, errorKey: 'GitLab create code review discussion' },
							`Error creating code review comment: ${message}`,
						);
					}
				}
			} else {
				// --- No violations found - Update the IN-MEMORY Set ---
				logger.debug(
					{ fingerprint: reviewResult.fingerprint, file: reviewResult.mrDiff.new_path, rule: reviewResult.reviewConfig.title },
					'Marking review unit as clean in working cache object',
				);
				// Add the fingerprint string to the Set
				workingCacheObject.fingerprints.add(reviewResult.fingerprint);
				cacheNeedsUpdate = true; // Mark that the Set has changed
			}
		}

		// --- Save Cache OBJECT (Conditional) ---
		if (cacheNeedsUpdate) {
			logger.info({ mrIid: mergeRequestIId }, 'Saving updated merge request review cache object to Firestore...');
			// Pass the entire working object (containing the updated Set)
			await codeReviewService.updateMergeRequestReviewCache(gitlabProjectId, mergeRequestIId, workingCacheObject);
		} else {
			logger.info({ mrIid: mergeRequestIId }, 'No changes to merge request review cache object needed.');
		}

		return diffs;
	}

	/**
	 * Helper to prepare code strings from a diff for LLM review and fingerprinting.
	 * Extracts added/context lines. Generates one version with line number comments
	 * for the LLM and one version with just the raw code for fingerprinting.
	 *
	 * @param mrDiff The merge request diff schema object.
	 * @returns An object containing { codeWithLines: string; codeWithoutLines: string; }
	 * @throws Error if the diff header cannot be parsed.
	 */
	prepareCodeForReview(mrDiff: MergeRequestDiffSchema): { codeWithLines: string; codeWithoutLines: string } {
		// Get the actual starting line number from the diff header @@ -old,cnt +new,cnt @@
		const headerMatch = mrDiff.diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m);
		let actualStartLine = 1;
		if (headerMatch?.[1]) {
			actualStartLine = parseInt(headerMatch[1], 10);
			if (actualStartLine === 0) actualStartLine = 1;
		} else {
			// If header is missing or malformed, log and potentially throw,
			// as line numbers are crucial for the LLM context.
			logger.error({ file: mrDiff.new_path, diffHeader: mrDiff.diff.split('\n')[0] }, 'CRITICAL: Could not parse starting line number from diff header.');
			// Throwing an error might be safer to prevent incorrect reviews/caching.
			throw new Error(`Could not parse diff header for ${mrDiff.new_path}`);
		}

		const lineCommenter = getBlankLineCommenter(mrDiff.new_path);
		const linesWithNumbers: string[] = [];
		const linesWithoutNumbers: string[] = [];
		let currentLineNumber = actualStartLine;

		// Split diff into lines, skip header
		const diffLines = mrDiff.diff.split('\n');
		let diffContentStartIndex = diffLines.findIndex((line) => line.startsWith('@@'));
		diffContentStartIndex = diffContentStartIndex === -1 ? 0 : diffContentStartIndex + 1;

		for (let i = diffContentStartIndex; i < diffLines.length; i++) {
			const line = diffLines[i];
			if (!line.startsWith('-')) {
				// Keep context (' ') and added ('+') lines
				const lineContent = line.startsWith('+') ? line.slice(1) : line.slice(1); // Also remove space from context lines

				// Version WITH line numbers for LLM
				linesWithNumbers.push(lineCommenter(currentLineNumber));
				linesWithNumbers.push(lineContent);

				// Version WITHOUT line numbers for fingerprinting
				linesWithoutNumbers.push(lineContent);

				currentLineNumber++;
			}
		}

		const codeWithLines = linesWithNumbers.join('\n');
		const codeWithoutLines = linesWithoutNumbers.join('\n');

		return { codeWithLines, codeWithoutLines };
	}

	/**
	 * Determine if a particular code review configuration is valid to perform on a diff
	 * @param codeReview
	 * @param diff
	 * @param projectPath
	 */
	shouldApplyCodeReview(codeReview: CodeReviewConfig, diff: MergeRequestDiffSchema, projectPath: string): boolean {
		if (!codeReview.enabled) return false;

		// If project paths are provided, then there must be a match
		if (codeReview.projectPaths.length && !micromatch.isMatch(projectPath, codeReview.projectPaths)) {
			logger.debug(`Project path globs ${codeReview.projectPaths} dont match ${projectPath}`);
			return false;
		}

		const hasMatchingExtension = codeReview.fileExtensions?.include.some((extension) => diff.new_path.endsWith(extension));
		const hasRequiredText = codeReview.requires?.text.some((text) => diff.diff.includes(text));
		// File extension and requires text are mandatory fields
		return hasMatchingExtension && hasRequiredText;
	}

	/**
	 * Review a diff from a merge request using the code review guidelines configured by the files in resources/codeReview
	 * @param mrDiff
	 * @param codeReview
	 * @param currentCode
	 */
	@cacheRetry()
	async reviewDiff(mrDiff: MergeRequestDiffSchema, codeReview: CodeReviewConfig, currentCode: string): Promise<DiffReview | null> {
		const prompt = `You are an AI software engineer tasked with reviewing code changes for our software development style standards.

Review Configuration:
${codeReviewToXml(codeReview)}

Code to Review:
<code>
${currentCode}
</code>

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
		// TODO force JSON schema
		const reviewComments = (await llms().medium.generateJson(prompt, { id: 'Diff code review', temperature: 0.5 })) as {
			violations: Array<{ lineNumber: number; comment: string }>;
		};

		if (Array.isArray(!reviewComments?.violations)) {
			logger.warn({ response: reviewComments }, 'Invalid code review [response]');
			return null;
		}

		return { code: currentCode, comments: reviewComments.violations, mrDiff, reviewConfig: codeReview };
	}

	/**
	 * Gets the logs for a CI/CD job
	 * @param projectIdOrProjectPath full path or numeric id
	 * @param jobId the job id
	 */
	@func()
	async getJobLogs(projectIdOrProjectPath: string | number, jobId: string): Promise<string> {
		if (!projectIdOrProjectPath) throw new Error('Parameter "projectPath" must be truthy');
		if (!jobId) throw new Error('Parameter "jobId" must be truthy');

		const project = await this.api().Projects.show(projectIdOrProjectPath);
		const job = await this.api().Jobs.show(project.id, jobId);

		return await this.api().Jobs.showLog(project.id, job.id);
	}

	/**
	 * Returns the Git diff for the commit in the git repository that the job is running the pipeline on.
	 * @param projectPath full project path or numeric id
	 * @param jobId the job id
	 */
	@func()
	async getJobCommitDiff(projectPath: string, jobId: string): Promise<string> {
		if (!projectPath) throw new Error('Parameter "projectPath" must be truthy');
		if (!jobId) throw new Error('Parameter "jobId" must be truthy');

		const project = await this.api().Projects.show(projectPath);
		const job = await this.api().Jobs.show(project.id, jobId);

		const commitDetails: CommitDiffSchema[] = await this.api().Commits.showDiff(projectPath, job.commit.id);
		return commitDetails.map((commitDiff) => commitDiff.diff).join('\n');
	}
}

export function getStartingLineNumber(diff: string): number {
	diff = diff.slice(diff.indexOf('+'));
	diff = diff.slice(0, diff.indexOf(','));
	return parseInt(diff);
}

function getBlankLineCommenter(fileName: string): (lineNumber: number) => string {
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

/** Generate a stable hash for a string */
function hashString(content: string): string {
	return crypto.createHash('sha256').update(content).digest('hex');
}

/** Generate fingerprint for caching clean reviews */
function generateReviewUnitFingerprint(
	projectId: string | number,
	mrIid: number,
	filePath: string,
	ruleId: string,
	ruleVersion: string | undefined,
	diffContentHash: string,
): string {
	const data = [
		`prj:${projectId}`,
		`mr:${mrIid}`,
		`file:${filePath}`,
		`rule:${ruleId}`,
		`ruleVer:${ruleVersion || 'v0'}`, // Use a default if version is missing
		`content:${diffContentHash}`,
	].join('|');
	return crypto.createHash('sha256').update(data).digest('hex');
}

// --- Violation Comment Deduplication Helpers ---

/** Generates a hash based on rule, file, line, and surrounding code context */
function generateContextHash(ruleId: string, filePath: string, lineNumber: number, codeLinesAroundViolation: string[]): string {
	const data = `${ruleId}::${filePath}::${lineNumber}::${codeLinesAroundViolation.join('\n')}`;
	return crypto.createHash('sha1').update(data).digest('hex').substring(0, 16); // Short hash is likely sufficient
}

/** Creates the identifier string */
function generateIdentifier(ruleId: string, filePath: string, contextHash: string): string {
	return `bot-review-id: rule=${ruleId}, file=${filePath}, contextHash=${contextHash}`;
}

/** Extracts the identifier from a comment body */
function extractIdentifier(commentBody: string): string | null {
	const match = commentBody.match(/<!-- (bot-review-id:.*?) -->/);
	return match ? match[1] : null;
}

/**
 * Attempts to get lines of code around a given line number from the LLM input string.
 * This is complex due to the injected line number comments.
 */
function getCodeContext(codeWithLineComments: string, targetLineNumber: number, windowSize: number): string[] {
	const lines = codeWithLineComments.split('\n');
	let targetLineIndex = -1;
	const lineNumRegex = /(?:\/\/|#|--|<!--|;)\s*(\d+)/;

	// Find the index of the *code line* corresponding to the targetLineNumber
	for (let i = 0; i < lines.length; i++) {
		// Check if the *previous* line was the comment for our target number
		if (i > 0) {
			const prevLineMatch = lines[i - 1].match(lineNumRegex);
			if (prevLineMatch && parseInt(prevLineMatch[1], 10) === targetLineNumber) {
				targetLineIndex = i; // The current line `i` is the code line for targetLineNumber
				break;
			}
		}
		// Less likely, but check if the current line is the comment itself (maybe LLM pointed there?)
		// const currentLineMatch = lines[i].match(lineNumRegex);
		// if (currentLineMatch && parseInt(currentLineMatch[1], 10) === targetLineNumber) {
		//     // If LLM pointed at the comment, use the *next* line as the target code line
		//     targetLineIndex = i + 1 < lines.length ? i + 1 : i;
		//     break;
		// }
	}

	if (targetLineIndex === -1) {
		logger.warn(`Could not reliably find code line index for lineNumber ${targetLineNumber} in code snippet.`);
		// Fallback: return something based on the target number to make the hash unique-ish
		return [`context_not_found_for_line_${targetLineNumber}`];
	}

	// Calculate start/end indices, ensuring they are even numbers to grab pairs of (comment, code)
	// This logic needs careful thought. Let's simplify: grab lines around the target code index.
	const startIndex = Math.max(0, targetLineIndex - windowSize);
	const endIndex = Math.min(lines.length, targetLineIndex + windowSize + 1);

	// Return the actual code lines from the context window, excluding the comments
	const contextLines: string[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		// Only include the actual code lines (assume they don't look like comments)
		if (!lines[i].match(lineNumRegex)) {
			contextLines.push(lines[i]);
		}
	}

	if (contextLines.length === 0 && targetLineIndex < lines.length) {
		// If context is empty maybe just return the target line itself
		contextLines.push(lines[targetLineIndex]);
	}

	return contextLines;
}
