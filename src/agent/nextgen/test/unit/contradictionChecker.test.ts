/**
 * Unit Tests for review/contradictionChecker.ts
 *
 * Tests the oscillation prevention mechanism that detects when new review
 * feedback contradicts previous design decisions.
 */

import { expect } from 'chai';
import { checkForContradictions, formatContradictionForReview, resolveContradiction } from '../../review/contradictionChecker';
import type { Contradiction, ContradictionCheckResult, DesignDecision, ReviewIssue } from '../../review/types';

describe('review/contradictionChecker', () => {
	// =============================================================================
	// Test Fixtures
	// =============================================================================

	function createDesignDecision(overrides: Partial<DesignDecision> = {}): DesignDecision {
		return {
			id: overrides.id ?? 'dd-1',
			category: overrides.category ?? 'architecture',
			decision: overrides.decision ?? 'Use hooks for state management',
			reasoning: overrides.reasoning ?? 'Hooks are more composable',
			alternatives_rejected: overrides.alternatives_rejected ?? ['Use classes', 'Use Redux'],
			madeAt: overrides.madeAt ?? new Date().toISOString(),
			madeBy: overrides.madeBy ?? 'review_agent',
			featureId: overrides.featureId ?? 'ft-1',
			reviewId: overrides.reviewId ?? 'rev-1',
		};
	}

	function createReviewIssue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
		return {
			id: overrides.id ?? 'issue-1',
			severity: overrides.severity ?? 'major',
			category: overrides.category ?? 'architecture',
			description: overrides.description ?? 'Review issue description',
			suggestion: overrides.suggestion,
			file: overrides.file,
			line: overrides.line,
		};
	}

	// =============================================================================
	// checkForContradictions Tests
	// =============================================================================

	describe('checkForContradictions', () => {
		describe('feedback contradictions', () => {
			it('detects contradiction when feedback suggests rejected alternative', () => {
				const previousDecisions = [
					createDesignDecision({
						decision: 'Use hooks for state management',
						alternatives_rejected: ['Use Redux', 'Use class components'],
					}),
				];
				const newFeedback = 'You should switch to Redux for better state management';
				const newIssues: ReviewIssue[] = [];

				const result = checkForContradictions(newFeedback, newIssues, previousDecisions);

				expect(result.hasContradiction).to.be.true;
				expect(result.contradictions).to.have.length(1);
				expect(result.contradictions[0].severity).to.equal('direct');
				expect(result.contradictions[0].newSuggestion).to.include('Redux');
			});

			it('detects contradiction with "use X" pattern', () => {
				const previousDecisions = [
					createDesignDecision({
						decision: 'Use TypeScript enums',
						alternatives_rejected: ['Use string literals', 'Use const objects'],
					}),
				];
				const newFeedback = 'Use const objects instead of enums';
				const newIssues: ReviewIssue[] = [];

				const result = checkForContradictions(newFeedback, newIssues, previousDecisions);

				expect(result.hasContradiction).to.be.true;
			});

			it('does not detect contradiction for unrelated feedback', () => {
				const previousDecisions = [
					createDesignDecision({
						decision: 'Use hooks for state management',
						alternatives_rejected: ['Use Redux', 'Use class components'],
					}),
				];
				const newFeedback = 'Add error handling for edge cases';
				const newIssues: ReviewIssue[] = [];

				const result = checkForContradictions(newFeedback, newIssues, previousDecisions);

				expect(result.hasContradiction).to.be.false;
				expect(result.contradictions).to.have.length(0);
			});

			it('is case-insensitive', () => {
				const previousDecisions = [
					createDesignDecision({
						decision: 'Use hooks',
						alternatives_rejected: ['Use REDUX'],
					}),
				];
				const newFeedback = 'You should switch to redux';
				const newIssues: ReviewIssue[] = [];

				const result = checkForContradictions(newFeedback, newIssues, previousDecisions);

				expect(result.hasContradiction).to.be.true;
			});
		});

		describe('issue contradictions', () => {
			it('detects contradiction when issue suggests rejected alternative', () => {
				const previousDecisions = [
					createDesignDecision({
						decision: 'Use functional components',
						alternatives_rejected: ['Use class components'],
					}),
				];
				const newFeedback = '';
				const newIssues = [
					createReviewIssue({
						description: 'Component structure issue',
						suggestion: 'Convert to class components for better lifecycle control',
					}),
				];

				const result = checkForContradictions(newFeedback, newIssues, previousDecisions);

				expect(result.hasContradiction).to.be.true;
				expect(result.contradictions[0].newSuggestion).to.include('class components');
			});

			it('detects contradiction in issue description', () => {
				const previousDecisions = [
					createDesignDecision({
						decision: 'Use async/await',
						alternatives_rejected: ['Use callbacks'],
					}),
				];
				const newFeedback = '';
				const newIssues = [
					createReviewIssue({
						description: 'Use callbacks for better error handling',
					}),
				];

				const result = checkForContradictions(newFeedback, newIssues, previousDecisions);

				expect(result.hasContradiction).to.be.true;
			});

			it('does not detect contradiction for unrelated issues', () => {
				const previousDecisions = [
					createDesignDecision({
						decision: 'Use hooks for state',
						alternatives_rejected: ['Use Redux'],
					}),
				];
				const newFeedback = '';
				const newIssues = [
					createReviewIssue({
						description: 'Missing unit tests',
						suggestion: 'Add tests for edge cases',
					}),
				];

				const result = checkForContradictions(newFeedback, newIssues, previousDecisions);

				expect(result.hasContradiction).to.be.false;
			});
		});

		describe('multiple decisions', () => {
			it('checks against all previous decisions', () => {
				const previousDecisions = [
					createDesignDecision({
						id: 'dd-1',
						decision: 'Use TypeScript',
						alternatives_rejected: ['Use JavaScript'],
					}),
					createDesignDecision({
						id: 'dd-2',
						decision: 'Use functional components',
						alternatives_rejected: ['Use class components'],
					}),
				];
				const newFeedback = 'Switch to class components for this feature';
				const newIssues: ReviewIssue[] = [];

				const result = checkForContradictions(newFeedback, newIssues, previousDecisions);

				expect(result.hasContradiction).to.be.true;
				expect(result.contradictions[0].previousDecisionId).to.equal('dd-2');
			});

			it('can detect multiple contradictions', () => {
				const previousDecisions = [
					createDesignDecision({
						id: 'dd-1',
						decision: 'Use TypeScript',
						alternatives_rejected: ['Use JavaScript'],
					}),
					createDesignDecision({
						id: 'dd-2',
						decision: 'Use hooks',
						alternatives_rejected: ['Use Redux'],
					}),
				];
				const newFeedback = '';
				const newIssues = [
					createReviewIssue({
						description: 'Use JavaScript for better compatibility',
					}),
					createReviewIssue({
						description: 'Use Redux for state management',
					}),
				];

				const result = checkForContradictions(newFeedback, newIssues, previousDecisions);

				expect(result.hasContradiction).to.be.true;
				expect(result.contradictions.length).to.be.at.least(2);
			});
		});

		describe('edge cases', () => {
			it('handles empty previous decisions', () => {
				const result = checkForContradictions('Any feedback', [], []);

				expect(result.hasContradiction).to.be.false;
				expect(result.contradictions).to.deep.equal([]);
			});

			it('handles empty feedback and issues', () => {
				const previousDecisions = [createDesignDecision()];

				const result = checkForContradictions('', [], previousDecisions);

				expect(result.hasContradiction).to.be.false;
			});

			it('handles decision with no rejected alternatives', () => {
				const previousDecisions = [
					createDesignDecision({
						alternatives_rejected: [],
					}),
				];

				const result = checkForContradictions('Use any approach', [], previousDecisions);

				expect(result.hasContradiction).to.be.false;
			});
		});
	});

	// =============================================================================
	// resolveContradiction Tests
	// =============================================================================

	describe('resolveContradiction', () => {
		it('escalates direct contradictions', () => {
			const contradiction: Contradiction = {
				previousDecisionId: 'dd-1',
				previousDecision: 'Use hooks',
				newSuggestion: 'Use Redux instead',
				severity: 'direct',
				explanation: 'Directly contradicts decision',
			};
			const decision = createDesignDecision({ id: 'dd-1' });

			const resolution = resolveContradiction(contradiction, decision);

			expect(resolution.action).to.equal('escalate');
			expect(resolution.reason).to.include('Human review required');
			expect(resolution.originalDecision).to.equal(decision);
			expect(resolution.contradiction).to.equal(contradiction);
		});

		it('warns on indirect contradictions', () => {
			const contradiction: Contradiction = {
				previousDecisionId: 'dd-1',
				previousDecision: 'Use hooks',
				newSuggestion: 'Consider state management patterns',
				severity: 'indirect',
				explanation: 'May conflict',
			};
			const decision = createDesignDecision({ id: 'dd-1' });

			const resolution = resolveContradiction(contradiction, decision);

			expect(resolution.action).to.equal('warn');
			expect(resolution.reason).to.include('Indirect contradiction');
		});

		it('notes potential contradictions', () => {
			const contradiction: Contradiction = {
				previousDecisionId: 'dd-1',
				previousDecision: 'Use hooks',
				newSuggestion: 'Review state management',
				severity: 'potential',
				explanation: 'Possible overlap',
			};
			const decision = createDesignDecision({ id: 'dd-1' });

			const resolution = resolveContradiction(contradiction, decision);

			expect(resolution.action).to.equal('note');
			expect(resolution.reason).to.include('Consider carefully');
		});
	});

	// =============================================================================
	// formatContradictionForReview Tests
	// =============================================================================

	describe('formatContradictionForReview', () => {
		it('returns no contradictions message when none exist', () => {
			const result: ContradictionCheckResult = {
				hasContradiction: false,
				contradictions: [],
			};

			const formatted = formatContradictionForReview(result);

			expect(formatted).to.equal('No contradictions detected.');
		});

		it('formats single contradiction', () => {
			const result: ContradictionCheckResult = {
				hasContradiction: true,
				contradictions: [
					{
						previousDecisionId: 'dd-1',
						previousDecision: 'Use hooks for state',
						newSuggestion: 'Use Redux instead',
						severity: 'direct',
						explanation: 'Directly contradicts previous decision',
					},
				],
			};

			const formatted = formatContradictionForReview(result);

			expect(formatted).to.include('## Contradictions Detected');
			expect(formatted).to.include('DIRECT Contradiction');
			expect(formatted).to.include('**Previous Decision (dd-1):** Use hooks for state');
			expect(formatted).to.include('**New Suggestion:** Use Redux instead');
			expect(formatted).to.include('**Explanation:** Directly contradicts previous decision');
		});

		it('formats multiple contradictions', () => {
			const result: ContradictionCheckResult = {
				hasContradiction: true,
				contradictions: [
					{
						previousDecisionId: 'dd-1',
						previousDecision: 'Decision 1',
						newSuggestion: 'Suggestion 1',
						severity: 'direct',
						explanation: 'Explanation 1',
					},
					{
						previousDecisionId: 'dd-2',
						previousDecision: 'Decision 2',
						newSuggestion: 'Suggestion 2',
						severity: 'indirect',
						explanation: 'Explanation 2',
					},
				],
			};

			const formatted = formatContradictionForReview(result);

			expect(formatted).to.include('DIRECT Contradiction');
			expect(formatted).to.include('INDIRECT Contradiction');
			expect(formatted).to.include('dd-1');
			expect(formatted).to.include('dd-2');
		});

		it('includes proper markdown formatting', () => {
			const result: ContradictionCheckResult = {
				hasContradiction: true,
				contradictions: [
					{
						previousDecisionId: 'dd-1',
						previousDecision: 'Test decision',
						newSuggestion: 'Test suggestion',
						severity: 'direct',
						explanation: 'Test explanation',
					},
				],
			};

			const formatted = formatContradictionForReview(result);

			// Check for markdown headers
			expect(formatted).to.include('## ');
			expect(formatted).to.include('### ');
			// Check for bold formatting
			expect(formatted).to.include('**Previous Decision');
			expect(formatted).to.include('**New Suggestion:**');
			expect(formatted).to.include('**Explanation:**');
		});
	});
});
