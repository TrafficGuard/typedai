/**
 * Contradiction Checker
 *
 * Detects when new review feedback contradicts previous design decisions.
 * This prevents the reviewer from flip-flopping on design choices.
 */

import type { Contradiction, ContradictionCheckResult, DesignDecision, ReviewIssue } from './types';

// =============================================================================
// Contradiction Detection
// =============================================================================

/**
 * Check if new review feedback contradicts any previous design decisions.
 */
export function checkForContradictions(newFeedback: string, newIssues: ReviewIssue[], previousDecisions: DesignDecision[]): ContradictionCheckResult {
	const contradictions: Contradiction[] = [];

	// Check each previous decision against new feedback and issues
	for (const decision of previousDecisions) {
		// Check direct contradiction in feedback text
		const feedbackContradiction = checkFeedbackContradiction(newFeedback, decision);
		if (feedbackContradiction) {
			contradictions.push(feedbackContradiction);
		}

		// Check contradiction in issues
		for (const issue of newIssues) {
			const issueContradiction = checkIssueContradiction(issue, decision);
			if (issueContradiction) {
				contradictions.push(issueContradiction);
			}
		}
	}

	return {
		hasContradiction: contradictions.length > 0,
		contradictions,
	};
}

/**
 * Check if feedback text contradicts a design decision.
 */
function checkFeedbackContradiction(feedback: string, decision: DesignDecision): Contradiction | null {
	const feedbackLower = feedback.toLowerCase();
	const decisionLower = decision.decision.toLowerCase();

	// Check if feedback suggests one of the rejected alternatives
	for (const rejected of decision.alternatives_rejected) {
		const rejectedLower = rejected.toLowerCase();

		// Extract key terms from the rejected alternative
		const keyTerms = extractKeyTerms(rejectedLower);

		// Check if feedback recommends the rejected alternative
		for (const term of keyTerms) {
			if (
				feedbackLower.includes(`use ${term}`) ||
				feedbackLower.includes(`switch to ${term}`) ||
				feedbackLower.includes(`should ${term}`) ||
				feedbackLower.includes(`recommend ${term}`)
			) {
				return {
					previousDecisionId: decision.id,
					previousDecision: decision.decision,
					newSuggestion: `Feedback suggests using "${rejected}"`,
					severity: 'direct',
					explanation: `The decision "${decision.decision}" explicitly rejected "${rejected}", but the new feedback appears to recommend it.`,
				};
			}
		}
	}

	// Check for opposite recommendations
	const oppositeCheck = checkOppositeRecommendation(feedbackLower, decisionLower, decision);
	if (oppositeCheck) {
		return oppositeCheck;
	}

	return null;
}

/**
 * Check if a review issue contradicts a design decision.
 */
function checkIssueContradiction(issue: ReviewIssue, decision: DesignDecision): Contradiction | null {
	const issueDesc = issue.description.toLowerCase();
	const suggestion = (issue.suggestion || '').toLowerCase();
	const decisionLower = decision.decision.toLowerCase();

	// Check if issue suggests reverting to a rejected alternative
	for (const rejected of decision.alternatives_rejected) {
		const rejectedLower = rejected.toLowerCase();
		const keyTerms = extractKeyTerms(rejectedLower);

		for (const term of keyTerms) {
			if (suggestion.includes(term) || issueDesc.includes(`use ${term}`)) {
				return {
					previousDecisionId: decision.id,
					previousDecision: decision.decision,
					newSuggestion: `Issue suggests: ${issue.suggestion || issue.description}`,
					severity: 'direct',
					explanation: `The decision rejected "${rejected}", but this issue suggests using it.`,
				};
			}
		}
	}

	// Check if issue criticizes the current decision
	const criticismCheck = checkCriticismOfDecision(issue, decision);
	if (criticismCheck) {
		return criticismCheck;
	}

	return null;
}

/**
 * Check for opposite recommendations (e.g., "use X" vs "don't use X").
 */
function checkOppositeRecommendation(feedback: string, decision: string, decisionObj: DesignDecision): Contradiction | null {
	// Common opposite patterns
	const oppositePatterns: Array<[RegExp, RegExp]> = [
		[/should use (\w+)/g, /should not use \1/g],
		[/prefer (\w+)/g, /avoid \1/g],
		[/use (\w+) pattern/g, /don't use \1 pattern/g],
		[/implement as (\w+)/g, /should not be \1/g],
	];

	for (const [positivePattern, negativePattern] of oppositePatterns) {
		const positiveMatch = decision.match(positivePattern);
		if (positiveMatch && negativePattern.test(feedback)) {
			return {
				previousDecisionId: decisionObj.id,
				previousDecision: decisionObj.decision,
				newSuggestion: feedback.slice(0, 100),
				severity: 'direct',
				explanation: 'New feedback suggests the opposite of the previous decision.',
			};
		}
	}

	return null;
}

/**
 * Check if an issue criticizes the approach used in a decision.
 */
function checkCriticismOfDecision(issue: ReviewIssue, decision: DesignDecision): Contradiction | null {
	const issueDesc = issue.description.toLowerCase();
	const decisionLower = decision.decision.toLowerCase();

	// Extract key terms from the decision
	const decisionTerms = extractKeyTerms(decisionLower);

	// Check if issue criticizes any of the key terms
	const criticalPhrases = ['should not', 'avoid', 'incorrect', 'wrong approach', 'anti-pattern', 'bad practice', 'problematic'];

	for (const term of decisionTerms) {
		for (const phrase of criticalPhrases) {
			if (issueDesc.includes(`${phrase} ${term}`) || issueDesc.includes(`${term} is ${phrase}`)) {
				return {
					previousDecisionId: decision.id,
					previousDecision: decision.decision,
					newSuggestion: issue.description,
					severity: 'indirect',
					explanation: `Issue criticizes "${term}" which was part of a previous design decision.`,
				};
			}
		}
	}

	return null;
}

/**
 * Extract key terms from a string for matching.
 */
function extractKeyTerms(text: string): string[] {
	// Remove common words and extract meaningful terms
	const stopWords = new Set([
		'the',
		'a',
		'an',
		'is',
		'are',
		'was',
		'were',
		'be',
		'been',
		'being',
		'have',
		'has',
		'had',
		'do',
		'does',
		'did',
		'will',
		'would',
		'could',
		'should',
		'may',
		'might',
		'must',
		'shall',
		'can',
		'to',
		'of',
		'in',
		'for',
		'on',
		'with',
		'at',
		'by',
		'from',
		'as',
		'or',
		'and',
		'not',
		'this',
		'that',
		'these',
		'those',
		'it',
		'its',
		'use',
		'using',
	]);

	return text
		.split(/\s+/)
		.filter((word) => word.length > 2)
		.filter((word) => !stopWords.has(word))
		.filter((word) => /^[a-z]+$/.test(word));
}

// =============================================================================
// Contradiction Resolution
// =============================================================================

/**
 * Determine how to handle a contradiction.
 */
export function resolveContradiction(contradiction: Contradiction, decision: DesignDecision): ContradictionResolution {
	switch (contradiction.severity) {
		case 'direct':
			// Direct contradiction: must escalate to human
			return {
				action: 'escalate',
				reason: `Direct contradiction with previous decision ${decision.id}. Human review required.`,
				originalDecision: decision,
				contradiction,
			};

		case 'indirect':
			// Indirect contradiction: can try to reconcile, but warn
			return {
				action: 'warn',
				reason: `Indirect contradiction detected. Review may conflict with decision ${decision.id}.`,
				originalDecision: decision,
				contradiction,
			};

		case 'potential':
			// Potential contradiction: just note it
			return {
				action: 'note',
				reason: `Potential conflict with decision ${decision.id}. Consider carefully.`,
				originalDecision: decision,
				contradiction,
			};
	}
}

export interface ContradictionResolution {
	action: 'escalate' | 'warn' | 'note';
	reason: string;
	originalDecision: DesignDecision;
	contradiction: Contradiction;
}

/**
 * Format contradiction for human review.
 */
export function formatContradictionForReview(result: ContradictionCheckResult): string {
	if (!result.hasContradiction) {
		return 'No contradictions detected.';
	}

	const lines: string[] = [];
	lines.push('## Contradictions Detected');
	lines.push('');
	lines.push('The following contradictions were found with previous design decisions:');
	lines.push('');

	for (const c of result.contradictions) {
		lines.push(`### ${c.severity.toUpperCase()} Contradiction`);
		lines.push(`**Previous Decision (${c.previousDecisionId}):** ${c.previousDecision}`);
		lines.push(`**New Suggestion:** ${c.newSuggestion}`);
		lines.push(`**Explanation:** ${c.explanation}`);
		lines.push('');
	}

	return lines.join('\n');
}
