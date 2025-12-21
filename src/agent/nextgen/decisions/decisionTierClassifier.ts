/**
 * Decision Tier Classifier
 *
 * Classifies decisions into tiers based on their impact and complexity.
 * Uses heuristics and optional LLM assistance for complex cases.
 */

import type { DecisionTier } from '../orchestrator/milestone';

// ============================================================================
// Classification Types
// ============================================================================

/**
 * Input for decision classification
 */
export interface DecisionInput {
	/** The question/choice being decided */
	question: string;
	/** Available options */
	options: string[];
	/** Context about the decision (optional) */
	context?: string;
	/** Files/areas affected (optional) */
	affectedAreas?: string[];
}

/**
 * Classification result
 */
export interface ClassificationResult {
	/** Classified tier */
	tier: DecisionTier;
	/** Confidence in the classification (0-1) */
	confidence: number;
	/** Reasoning for the classification */
	reasoning: string;
	/** Suggested approach */
	suggestion?: string;
}

// ============================================================================
// Classification Patterns
// ============================================================================

/**
 * Patterns that indicate trivial decisions
 */
const TRIVIAL_PATTERNS = [
	/variable\s*nam(e|ing)/i,
	/comment\s*style/i,
	/whitespace/i,
	/import\s*order/i,
	/bracket\s*style/i,
	/quote\s*style/i,
	/semicolon/i,
	/trailing\s*comma/i,
	/indentation/i,
];

/**
 * Patterns that indicate minor decisions
 */
const MINOR_PATTERNS = [
	/which\s*(utility|helper|function)/i,
	/error\s*message/i,
	/log(ging)?\s*(level|format)/i,
	/timeout\s*value/i,
	/default\s*value/i,
	/parameter\s*name/i,
	/method\s*name/i,
	/file\s*location/i,
];

/**
 * Patterns that indicate medium decisions
 */
const MEDIUM_PATTERNS = [
	/api\s*(design|structure|format)/i,
	/data\s*model/i,
	/state\s*management/i,
	/component\s*(structure|design)/i,
	/error\s*handling\s*strategy/i,
	/caching\s*strategy/i,
	/validation\s*(approach|strategy)/i,
	/testing\s*strategy/i,
];

/**
 * Patterns that indicate major decisions
 */
const MAJOR_PATTERNS = [
	/architect(ure|ural)/i,
	/database\s*(schema|design|migration)/i,
	/security/i,
	/authentication/i,
	/authorization/i,
	/breaking\s*change/i,
	/deprecat/i,
	/infrastructure/i,
	/deployment/i,
	/third[-\s]*party/i,
	/external\s*service/i,
	/migration\s*strategy/i,
];

/**
 * Keywords that increase decision severity
 */
const SEVERITY_KEYWORDS = ['breaking', 'irreversible', 'production', 'security', 'data loss', 'migration', 'backward compatibility'];

/**
 * Keywords that decrease decision severity
 */
const SIMPLICITY_KEYWORDS = ['cosmetic', 'style', 'formatting', 'preference', 'convention', 'minor', 'small'];

// ============================================================================
// Classifier Implementation
// ============================================================================

/**
 * Classifies a decision into a tier
 */
export function classifyDecision(input: DecisionInput): ClassificationResult {
	const { question, options, context, affectedAreas } = input;

	// Combine all text for pattern matching
	const allText = [question, ...options, context ?? '', ...(affectedAreas ?? [])].join(' ').toLowerCase();

	// Check patterns in order of severity
	let tier: DecisionTier = 'minor'; // Default
	let matchedPattern = '';
	let confidence = 0.5;

	// Check for major patterns first
	for (const pattern of MAJOR_PATTERNS) {
		if (pattern.test(allText)) {
			tier = 'major';
			matchedPattern = pattern.source;
			confidence = 0.8;
			break;
		}
	}

	// If not major, check for medium
	if (tier !== 'major') {
		for (const pattern of MEDIUM_PATTERNS) {
			if (pattern.test(allText)) {
				tier = 'medium';
				matchedPattern = pattern.source;
				confidence = 0.7;
				break;
			}
		}
	}

	// If not major or medium, check for trivial
	if (tier !== 'major' && tier !== 'medium') {
		for (const pattern of TRIVIAL_PATTERNS) {
			if (pattern.test(allText)) {
				tier = 'trivial';
				matchedPattern = pattern.source;
				confidence = 0.9;
				break;
			}
		}
	}

	// If still minor, check minor patterns to confirm
	if (tier === 'minor') {
		for (const pattern of MINOR_PATTERNS) {
			if (pattern.test(allText)) {
				matchedPattern = pattern.source;
				confidence = 0.75;
				break;
			}
		}
	}

	// Adjust based on severity/simplicity keywords
	const severityCount = SEVERITY_KEYWORDS.filter((kw) => allText.includes(kw)).length;
	const simplicityCount = SIMPLICITY_KEYWORDS.filter((kw) => allText.includes(kw)).length;

	if (severityCount > simplicityCount) {
		// Bump up severity
		if (tier === 'trivial') tier = 'minor';
		else if (tier === 'minor') tier = 'medium';
		else if (tier === 'medium') tier = 'major';
	} else if (simplicityCount > severityCount) {
		// Bump down severity
		if (tier === 'major') tier = 'medium';
		else if (tier === 'medium') tier = 'minor';
		else if (tier === 'minor') tier = 'trivial';
	}

	// Adjust based on number of options
	if (options.length > 3 && tier !== 'major') {
		// Many options suggests more complexity
		if (tier === 'trivial') tier = 'minor';
		else if (tier === 'minor') tier = 'medium';
	}

	// Adjust based on affected areas
	if (affectedAreas && affectedAreas.length > 5 && tier !== 'major') {
		// Many affected areas suggests more impact
		if (tier === 'trivial') tier = 'minor';
		else if (tier === 'minor') tier = 'medium';
		else if (tier === 'medium') tier = 'major';
	}

	// Build reasoning
	const reasoning = buildReasoning(tier, matchedPattern, severityCount, simplicityCount, options.length, affectedAreas?.length ?? 0);

	// Build suggestion
	const suggestion = buildSuggestion(tier);

	return {
		tier,
		confidence,
		reasoning,
		suggestion,
	};
}

/**
 * Builds reasoning string for the classification
 */
function buildReasoning(
	tier: DecisionTier,
	matchedPattern: string,
	severityCount: number,
	simplicityCount: number,
	optionCount: number,
	affectedAreaCount: number,
): string {
	const parts: string[] = [];

	if (matchedPattern) {
		parts.push(`Matched pattern: "${matchedPattern}"`);
	}

	if (severityCount > 0) {
		parts.push(`Found ${severityCount} severity keyword(s)`);
	}

	if (simplicityCount > 0) {
		parts.push(`Found ${simplicityCount} simplicity keyword(s)`);
	}

	if (optionCount > 3) {
		parts.push(`Many options (${optionCount}) suggests complexity`);
	}

	if (affectedAreaCount > 5) {
		parts.push(`Many affected areas (${affectedAreaCount}) suggests high impact`);
	}

	if (parts.length === 0) {
		parts.push('Default classification based on general analysis');
	}

	return `Classified as ${tier}: ${parts.join('. ')}.`;
}

/**
 * Builds suggestion string for the tier
 */
function buildSuggestion(tier: DecisionTier): string {
	switch (tier) {
		case 'trivial':
			return 'Make the decision and move on. No need to record.';
		case 'minor':
			return 'Make the decision and record it to decisions.md for async review.';
		case 'medium':
			return 'Analyze with AI first. If no clear winner, implement both options in parallel.';
		case 'major':
			return 'Stop and ask the human for guidance. This decision has significant impact.';
	}
}

// ============================================================================
// Batch Classification
// ============================================================================

/**
 * Classifies multiple decisions
 */
export function classifyDecisions(inputs: DecisionInput[]): ClassificationResult[] {
	return inputs.map(classifyDecision);
}

/**
 * Gets the highest tier from a list of decisions
 */
export function getHighestTier(tiers: DecisionTier[]): DecisionTier {
	const order: DecisionTier[] = ['trivial', 'minor', 'medium', 'major'];
	let highest = 0;

	for (const tier of tiers) {
		const idx = order.indexOf(tier);
		if (idx > highest) highest = idx;
	}

	return order[highest];
}

// ============================================================================
// Tier Utilities
// ============================================================================

/**
 * Checks if a tier requires human input
 */
export function requiresHumanInput(tier: DecisionTier): boolean {
	return tier === 'major';
}

/**
 * Checks if a tier should be recorded
 */
export function shouldRecord(tier: DecisionTier): boolean {
	return tier !== 'trivial';
}

/**
 * Checks if a tier may trigger parallel exploration
 */
export function mayTriggerParallel(tier: DecisionTier): boolean {
	return tier === 'medium';
}

/**
 * Gets tier display name
 */
export function getTierDisplayName(tier: DecisionTier): string {
	switch (tier) {
		case 'trivial':
			return 'Trivial';
		case 'minor':
			return 'Minor';
		case 'medium':
			return 'Medium';
		case 'major':
			return 'Major';
	}
}

/**
 * Gets tier color for UI
 */
export function getTierColor(tier: DecisionTier): string {
	switch (tier) {
		case 'trivial':
			return 'gray';
		case 'minor':
			return 'blue';
		case 'medium':
			return 'yellow';
		case 'major':
			return 'red';
	}
}
