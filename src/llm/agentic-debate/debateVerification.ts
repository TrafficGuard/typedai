/**
 * Fresh Verification Pass
 *
 * Implements a fresh verification phase that runs in a new LLM context
 * (no debate history) to avoid:
 * - Sycophantic behavior (agreeing with prior claims)
 * - Context pollution from debate back-and-forth
 * - Long-context reasoning degradation
 *
 * The verifier independently checks each claim using available tools
 * and provides citations for verified claims or corrections for incorrect ones.
 *
 * @module agentic-debate/verification
 */

import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { LLM } from '#shared/llm/llm.model';
import { buildVerificationPrompt, extractJsonFromResponse } from './debatePrompts';
import { executeToolRequests, formatToolResultsForPrompt } from './debateTools';
import type { Citation, Claim, DebateTool, SynthesizedAnswer, ToolCallRecord, VerifiedAnswer } from './toolEnabledDebate';

const log = logger.child({ module: 'DebateVerification' });

/**
 * Response structure from the verification LLM
 */
interface VerificationResponse {
	verifiedAnswer: string;
	claims: Array<{
		claim: string;
		status: 'verified' | 'unverified' | 'incorrect';
		citation?: Citation;
		correction?: string;
	}>;
	corrections: string[];
	citations: Citation[];
}

/**
 * Run a fresh verification pass on the synthesized answer.
 *
 * This creates a completely new LLM context with no debate history,
 * allowing the verifier to independently assess each claim.
 */
export async function freshVerificationPass(
	topic: string,
	synthesizedAnswer: SynthesizedAnswer,
	tools: DebateTool[],
	verificationLLM: LLM,
	options?: {
		maxToolCalls?: number;
		debug?: boolean;
	},
): Promise<VerifiedAnswer> {
	return withActiveSpan('fresh-verification-pass', async () => {
		const maxToolCalls = options?.maxToolCalls ?? 10;
		const debug = options?.debug ?? false;

		log.info({ topic, answerLength: synthesizedAnswer.answer.length }, 'Starting fresh verification pass');

		// Build the verification prompt (fresh context - no debate history)
		const initialPrompt = buildVerificationPrompt(topic, synthesizedAnswer, tools);

		// First pass: get initial verification with tool requests
		let response = await verificationLLM.generateText(initialPrompt, {
			id: 'verification-initial',
			thinking: 'high',
			temperature: 0.2,
		});

		// Execute tools if the verifier requests them
		const allToolCalls: ToolCallRecord[] = [];
		let toolCallCount = 0;

		// Allow the verifier to make tool calls to verify claims
		let needsMoreTools = extractToolRequests(response);

		while (needsMoreTools.length > 0 && toolCallCount < maxToolCalls) {
			if (debug) {
				log.debug({ toolRequests: needsMoreTools }, 'Verifier requested tools');
			}

			const toolResults = await executeToolRequests(tools, needsMoreTools, 'verifier');
			allToolCalls.push(...toolResults);
			toolCallCount += toolResults.length;

			// Generate refined verification with tool results
			const toolResultsText = formatToolResultsForPrompt(toolResults);

			const refinedPrompt = `${initialPrompt}

TOOL RESULTS FROM VERIFICATION:
${toolResultsText}

Based on these tool results, provide your final verification. Respond with a JSON object as specified above.`;

			response = await verificationLLM.generateText(refinedPrompt, {
				id: `verification-refined-${toolCallCount}`,
				thinking: 'high',
				temperature: 0.2,
			});

			needsMoreTools = extractToolRequests(response);
		}

		// Parse the final verification response
		const verificationResult = parseVerificationResponse(response, synthesizedAnswer);

		log.info(
			{
				claimCount: verificationResult.claims.length,
				verifiedCount: verificationResult.claims.filter((c) => c.status === 'verified').length,
				incorrectCount: verificationResult.claims.filter((c) => c.status === 'incorrect').length,
				correctionCount: verificationResult.corrections.length,
			},
			'Verification complete',
		);

		return verificationResult;
	});
}

/**
 * Extract tool requests from a verification response
 */
function extractToolRequests(response: string): Array<{ toolName: string; parameters: Record<string, unknown> }> {
	const requests: Array<{ toolName: string; parameters: Record<string, unknown> }> = [];

	// Look for tool request patterns using matchAll
	const toolRequestPattern = /<tool_request name="([^"]+)">([\s\S]*?)<\/tool_request>/g;
	for (const match of response.matchAll(toolRequestPattern)) {
		try {
			const params = JSON.parse(match[2]);
			requests.push({
				toolName: match[1],
				parameters: params,
			});
		} catch {
			// Ignore invalid tool requests
		}
	}

	// Also look for JSON-style tool requests
	const jsonToolPattern = /"toolRequests"\s*:\s*\[([\s\S]*?)\]/;
	const jsonMatch = response.match(jsonToolPattern);
	if (jsonMatch) {
		try {
			const toolRequests = JSON.parse(`[${jsonMatch[1]}]`);
			for (const req of toolRequests) {
				if (req.toolName && req.parameters) {
					requests.push(req);
				}
			}
		} catch {
			// Ignore parse errors
		}
	}

	return requests;
}

/**
 * Parse the verification response into a VerifiedAnswer
 */
function parseVerificationResponse(response: string, originalAnswer: SynthesizedAnswer): VerifiedAnswer {
	try {
		const parsed = extractJsonFromResponse<VerificationResponse>(response);

		return {
			originalAnswer: originalAnswer.answer,
			verifiedAnswer: parsed.verifiedAnswer || originalAnswer.answer,
			claims: parsed.claims.map((c) => ({
				claim: c.claim,
				status: c.status,
				citation: c.citation,
				correction: c.correction,
			})),
			corrections: parsed.corrections || [],
			citations: parsed.citations || [],
		};
	} catch (error) {
		log.warn({ error }, 'Failed to parse verification response, extracting manually');

		// Fallback: try to extract what we can
		return manuallyExtractVerification(response, originalAnswer);
	}
}

/**
 * Manually extract verification results from unstructured text
 */
function manuallyExtractVerification(response: string, originalAnswer: SynthesizedAnswer): VerifiedAnswer {
	const claims: Claim[] = [];
	const corrections: string[] = [];
	const citations: Citation[] = [];

	// Look for VERIFIED/UNVERIFIED/INCORRECT markers
	const claimPattern = /(VERIFIED|UNVERIFIED|INCORRECT)[:\s]+([^\n]+)/gi;
	for (const match of response.matchAll(claimPattern)) {
		const status = match[1].toLowerCase() as 'verified' | 'unverified' | 'incorrect';
		claims.push({
			claim: match[2].trim(),
			status,
		});
	}

	// Look for corrections
	const correctionPattern = /correction[:\s]+([^\n]+)/gi;
	for (const match of response.matchAll(correctionPattern)) {
		corrections.push(match[1].trim());
	}

	// Look for file citations
	const filePattern = /(?:file|path)[:\s]+[`"]?([^\s`"]+\.[a-z]+)[`"]?/gi;
	for (const match of response.matchAll(filePattern)) {
		citations.push({
			type: 'file',
			source: match[1],
			excerpt: '',
		});
	}

	// Look for URL citations
	const urlPattern = /https?:\/\/[^\s)]+/g;
	for (const match of response.matchAll(urlPattern)) {
		citations.push({
			type: 'url',
			source: match[0],
			excerpt: '',
		});
	}

	// Try to find verified answer
	const verifiedAnswerPattern = /"?verifiedAnswer"?\s*[:\s]+["']?([\s\S]+?)(?:["']?\s*[,}]|$)/i;
	const answerMatch = response.match(verifiedAnswerPattern);
	const verifiedAnswer = answerMatch ? answerMatch[1].trim() : response;

	return {
		originalAnswer: originalAnswer.answer,
		verifiedAnswer,
		claims,
		corrections,
		citations,
	};
}

/**
 * Quick verification that just checks if claims have citations
 * Used for fast preliminary verification before full verification pass
 */
export function quickVerifyHasCitations(claims: Claim[]): {
	allVerified: boolean;
	unverifiedClaims: string[];
} {
	const unverifiedClaims = claims.filter((c) => c.status === 'verified' && !c.citation).map((c) => c.claim);

	return {
		allVerified: unverifiedClaims.length === 0,
		unverifiedClaims,
	};
}

/**
 * Extract claims from an answer text for verification
 */
export async function extractClaimsFromAnswer(answer: string, llm: LLM): Promise<string[]> {
	const prompt = `Extract all factual claims from the following answer. Return each claim as a separate item.

ANSWER:
${answer}

Return a JSON array of claims:
\`\`\`json
["claim 1", "claim 2", "claim 3"]
\`\`\``;

	const response = await llm.generateText(prompt, {
		id: 'extract-claims',
		thinking: 'low',
		temperature: 0,
	});

	try {
		return extractJsonFromResponse<string[]>(response);
	} catch {
		// Fallback: split by sentences
		return answer
			.split(/[.!?]+/)
			.map((s) => s.trim())
			.filter((s) => s.length > 20);
	}
}
