/**
 * Decision Manager
 *
 * Handles the complete decision lifecycle across all tiers.
 * Coordinates between classification, analysis, recording, and parallel exploration.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '#o11y/logger';
import type { LLM } from '#shared/agent/agent.model';
import type { KnowledgeBase } from '../learning/knowledgeBase';
import type { Decision, DecisionTier, OptionDefinition } from '../orchestrator/milestone';
import { type DecisionAnalysisResult, DecisionAnalyzer, stringsToOptionDefinitions } from './decisionAnalyzer';
import { type ClassificationResult, classifyDecision, requiresHumanInput, shouldRecord } from './decisionTierClassifier';

// ============================================================================
// Decision Manager Types
// ============================================================================

/**
 * Input for making a decision
 */
export interface MakeDecisionInput {
	/** The question being decided */
	question: string;
	/** Available options (simple strings or full definitions) */
	options: string[] | OptionDefinition[];
	/** Context about the decision */
	context?: string;
	/** Affected files/areas */
	affectedAreas?: string[];
	/** Current subtask ID */
	subtaskId?: string;
	/** Override tier classification */
	forceTier?: DecisionTier;
}

/**
 * Result of making a decision
 */
export interface MakeDecisionResult {
	/** The recorded decision */
	decision: Decision;
	/** Classification result */
	classification: ClassificationResult;
	/** Analysis result (for medium tier) */
	analysis?: DecisionAnalysisResult;
	/** Whether parallel exploration was triggered */
	parallelTriggered: boolean;
	/** Whether human input is required */
	requiresHuman: boolean;
}

/**
 * Callback for requesting human input
 */
export type HumanInputCallback = (question: string, options: string[], context: string) => Promise<string>;

/**
 * Callback for parallel exploration
 */
export type ParallelExplorationCallback = (options: OptionDefinition[]) => Promise<string>;

// ============================================================================
// Decision Manager Configuration
// ============================================================================

export interface DecisionManagerConfig {
	/** LLM for analysis */
	llm: LLM;
	/** Knowledge base */
	knowledgeBase: KnowledgeBase;
	/** Directory for decisions.md files */
	decisionsDir: string;
	/** Current task ID (for file naming) */
	taskId: string;
	/** Current task description */
	taskDescription: string;
	/** Callback for human input (major decisions) */
	humanInputCallback?: HumanInputCallback;
	/** Callback for parallel exploration (medium decisions) */
	parallelExplorationCallback?: ParallelExplorationCallback;
}

// ============================================================================
// Decision Manager Implementation
// ============================================================================

/**
 * Manages decisions across all tiers
 */
export class DecisionManager {
	private config: DecisionManagerConfig;
	private analyzer: DecisionAnalyzer;
	private decisions: Decision[] = [];
	private nextDecisionId = 1;

	constructor(config: DecisionManagerConfig) {
		this.config = config;
		this.analyzer = new DecisionAnalyzer({
			llm: config.llm,
			knowledgeBase: config.knowledgeBase,
			clearWinnerThreshold: 0.75,
			parallelThreshold: 0.15,
		});
	}

	/**
	 * Makes a decision, handling all tier-specific logic
	 */
	async makeDecision(input: MakeDecisionInput): Promise<MakeDecisionResult> {
		// Normalize options to strings
		const optionStrings = this.normalizeOptions(input.options);
		const optionDefs = this.toOptionDefinitions(input.options);

		// Classify the decision
		const classification = classifyDecision({
			question: input.question,
			options: optionStrings,
			context: input.context,
			affectedAreas: input.affectedAreas,
		});

		// Use forced tier if provided
		const tier = input.forceTier ?? classification.tier;

		logger.info({ question: input.question.slice(0, 50), tier, confidence: classification.confidence }, 'Decision classified');

		// Handle based on tier
		let result: MakeDecisionResult;

		switch (tier) {
			case 'trivial':
				result = await this.handleTrivial(input, optionStrings, classification);
				break;
			case 'minor':
				result = await this.handleMinor(input, optionStrings, classification);
				break;
			case 'medium':
				result = await this.handleMedium(input, optionStrings, optionDefs, classification);
				break;
			case 'major':
				result = await this.handleMajor(input, optionStrings, classification);
				break;
		}

		return result;
	}

	/**
	 * Gets all recorded decisions
	 */
	getDecisions(): Decision[] {
		return [...this.decisions];
	}

	/**
	 * Gets decisions by tier
	 */
	getDecisionsByTier(tier: DecisionTier): Decision[] {
		return this.decisions.filter((d) => d.tier === tier);
	}

	/**
	 * Gets pending review decisions
	 */
	getPendingReviewDecisions(): Decision[] {
		return this.decisions.filter((d) => d.reviewStatus === 'pending');
	}

	/**
	 * Updates a decision's review status
	 */
	async updateReviewStatus(decisionId: string, status: 'approved' | 'overridden', feedback?: string): Promise<void> {
		const decision = this.decisions.find((d) => d.id === decisionId);
		if (!decision) {
			throw new Error(`Decision not found: ${decisionId}`);
		}

		decision.reviewStatus = status;
		if (feedback) {
			decision.humanFeedback = feedback;
		}

		// Update in file
		await this.updateDecisionInFile(decision);
	}

	// ========================================================================
	// Tier Handlers
	// ========================================================================

	/**
	 * Handles trivial decisions - just pick and move on
	 */
	private async handleTrivial(input: MakeDecisionInput, options: string[], classification: ClassificationResult): Promise<MakeDecisionResult> {
		// Just pick the first option (or could use simple heuristics)
		const chosenOption = options[0];

		const decision = this.createDecision({
			tier: 'trivial',
			question: input.question,
			options,
			chosenOption,
			reasoning: 'Trivial decision - no significant difference between options.',
			madeBy: 'agent',
			reviewStatus: 'approved', // Trivial decisions don't need review
			subtaskId: input.subtaskId,
		});

		// Don't record trivial decisions to file
		this.decisions.push(decision);

		return {
			decision,
			classification,
			parallelTriggered: false,
			requiresHuman: false,
		};
	}

	/**
	 * Handles minor decisions - decide and record for async review
	 */
	private async handleMinor(input: MakeDecisionInput, options: string[], classification: ClassificationResult): Promise<MakeDecisionResult> {
		// Pick the first option with basic reasoning
		const chosenOption = options[0];

		const decision = this.createDecision({
			tier: 'minor',
			question: input.question,
			options,
			chosenOption,
			reasoning: classification.reasoning,
			madeBy: 'agent',
			reviewStatus: 'pending',
			subtaskId: input.subtaskId,
		});

		this.decisions.push(decision);

		// Record to file for async review
		await this.recordDecisionToFile(decision);

		return {
			decision,
			classification,
			parallelTriggered: false,
			requiresHuman: false,
		};
	}

	/**
	 * Handles medium decisions - analyze first, then parallel if needed
	 */
	private async handleMedium(
		input: MakeDecisionInput,
		options: string[],
		optionDefs: OptionDefinition[],
		classification: ClassificationResult,
	): Promise<MakeDecisionResult> {
		// Analyze the decision with AI
		const analysis = await this.analyzer.analyze({
			question: input.question,
			options: optionDefs,
			context: input.context ?? '',
			affectedAreas: input.affectedAreas ?? [],
			taskDescription: this.config.taskDescription,
		});

		logger.info(
			{
				hasClearWinner: analysis.hasClearWinner,
				confidence: analysis.confidence,
				recommendParallel: analysis.recommendParallel,
			},
			'Medium decision analyzed',
		);

		if (analysis.hasClearWinner && analysis.confidence >= 0.75) {
			// Clear winner - make the decision
			const chosenOption = analysis.recommendedOption ?? options[0];

			const decision = this.createDecision({
				tier: 'medium',
				question: input.question,
				options,
				chosenOption,
				reasoning: analysis.reasoning,
				madeBy: 'agent',
				reviewStatus: 'pending',
				subtaskId: input.subtaskId,
			});

			this.decisions.push(decision);
			await this.recordDecisionToFile(decision);

			return {
				decision,
				classification,
				analysis,
				parallelTriggered: false,
				requiresHuman: false,
			};
		}

		// No clear winner - trigger parallel exploration if callback available
		if (analysis.recommendParallel && this.config.parallelExplorationCallback) {
			logger.info({ options: optionDefs.length }, 'Triggering parallel exploration');

			const chosenOptionId = await this.config.parallelExplorationCallback(optionDefs);
			const chosenOption = options.find((_, i) => optionDefs[i].id === chosenOptionId) ?? options[0];

			const decision = this.createDecision({
				tier: 'medium',
				question: input.question,
				options,
				chosenOption,
				reasoning: `Parallel exploration selected: ${analysis.reasoning}`,
				madeBy: 'human', // Human made final selection
				reviewStatus: 'approved',
				subtaskId: input.subtaskId,
			});

			this.decisions.push(decision);
			await this.recordDecisionToFile(decision);

			return {
				decision,
				classification,
				analysis,
				parallelTriggered: true,
				requiresHuman: false, // Already handled by callback
			};
		}

		// Fallback: just pick the recommended option
		const chosenOption = analysis.recommendedOption ?? options[0];

		const decision = this.createDecision({
			tier: 'medium',
			question: input.question,
			options,
			chosenOption,
			reasoning: analysis.reasoning,
			madeBy: 'agent',
			reviewStatus: 'pending',
			subtaskId: input.subtaskId,
		});

		this.decisions.push(decision);
		await this.recordDecisionToFile(decision);

		return {
			decision,
			classification,
			analysis,
			parallelTriggered: false,
			requiresHuman: false,
		};
	}

	/**
	 * Handles major decisions - must get human input
	 */
	private async handleMajor(input: MakeDecisionInput, options: string[], classification: ClassificationResult): Promise<MakeDecisionResult> {
		if (!this.config.humanInputCallback) {
			// No callback - create decision requiring human review
			const decision = this.createDecision({
				tier: 'major',
				question: input.question,
				options,
				chosenOption: '', // Not decided yet
				reasoning: 'Major decision requires human input.',
				madeBy: 'agent',
				reviewStatus: 'pending',
				subtaskId: input.subtaskId,
			});

			this.decisions.push(decision);
			await this.recordDecisionToFile(decision);

			return {
				decision,
				classification,
				parallelTriggered: false,
				requiresHuman: true,
			};
		}

		// Get human input
		logger.info({ question: input.question.slice(0, 50) }, 'Requesting human input for major decision');

		const chosenOption = await this.config.humanInputCallback(input.question, options, input.context ?? '');

		const decision = this.createDecision({
			tier: 'major',
			question: input.question,
			options,
			chosenOption,
			reasoning: 'Human decision.',
			madeBy: 'human',
			reviewStatus: 'approved',
			subtaskId: input.subtaskId,
		});

		this.decisions.push(decision);
		await this.recordDecisionToFile(decision);

		return {
			decision,
			classification,
			parallelTriggered: false,
			requiresHuman: false, // Already handled
		};
	}

	// ========================================================================
	// Helper Methods
	// ========================================================================

	/**
	 * Normalizes options to string array
	 */
	private normalizeOptions(options: string[] | OptionDefinition[]): string[] {
		if (options.length === 0) return [];
		if (typeof options[0] === 'string') {
			return options as string[];
		}
		return (options as OptionDefinition[]).map((o) => o.description);
	}

	/**
	 * Converts to OptionDefinitions
	 */
	private toOptionDefinitions(options: string[] | OptionDefinition[]): OptionDefinition[] {
		if (options.length === 0) return [];
		if (typeof options[0] === 'string') {
			return stringsToOptionDefinitions(options as string[]);
		}
		return options as OptionDefinition[];
	}

	/**
	 * Creates a decision object
	 */
	private createDecision(data: Omit<Decision, 'id' | 'timestamp'>): Decision {
		return {
			id: `decision-${this.nextDecisionId++}`,
			timestamp: Date.now(),
			...data,
		};
	}

	/**
	 * Records a decision to decisions.md file
	 */
	private async recordDecisionToFile(decision: Decision): Promise<void> {
		const decisionsPath = join(this.config.decisionsDir, `${this.config.taskId}-decisions.md`);

		const tierEmoji = {
			trivial: '',
			minor: '',
			medium: '',
			major: ' (escalated to human)',
		};

		const entry = `
## [${new Date(decision.timestamp).toISOString()}] ${decision.question.slice(0, 60)}${decision.question.length > 60 ? '...' : ''}
- **ID**: ${decision.id}
- **Tier**: ${decision.tier}${tierEmoji[decision.tier]}
- **Question**: ${decision.question}
- **Options**:
${decision.options.map((opt, i) => `  ${i + 1}. ${opt}`).join('\n')}
- **Chosen**: ${decision.chosenOption || '(Not yet decided)'}
- **Reasoning**: ${decision.reasoning}
- **Made by**: ${decision.madeBy}
- **Review Status**: ${decision.reviewStatus}
${decision.humanFeedback ? `- **Human Feedback**: ${decision.humanFeedback}` : ''}
${decision.subtaskId ? `- **Subtask**: ${decision.subtaskId}` : ''}

---
`;

		try {
			await mkdir(this.config.decisionsDir, { recursive: true });

			try {
				// Check if file exists
				await readFile(decisionsPath, 'utf-8');
				// Append to existing file
				await appendFile(decisionsPath, entry);
			} catch {
				// Create new file with header
				const header = `# Decisions Log

**Task**: ${this.config.taskDescription}
**Task ID**: ${this.config.taskId}
**Created**: ${new Date().toISOString()}

---
`;
				await writeFile(decisionsPath, header + entry);
			}

			logger.debug({ decisionId: decision.id, file: decisionsPath }, 'Decision recorded to file');
		} catch (e) {
			logger.error(e, 'Failed to record decision to file');
		}
	}

	/**
	 * Updates a decision in the file (for review status changes)
	 */
	private async updateDecisionInFile(decision: Decision): Promise<void> {
		const decisionsPath = join(this.config.decisionsDir, `${this.config.taskId}-decisions.md`);

		try {
			let content = await readFile(decisionsPath, 'utf-8');

			// Find and update the decision entry
			const idPattern = new RegExp(`- \\*\\*ID\\*\\*: ${decision.id}[\\s\\S]*?(?=\\n## |$)`, 'g');

			// This is a simplified update - a real implementation would be more robust
			content = content.replace(/- \*\*Review Status\*\*: pending/g, `- **Review Status**: ${decision.reviewStatus}`);

			if (decision.humanFeedback) {
				content = content.replace(new RegExp(`(- \\*\\*ID\\*\\*: ${decision.id}[\\s\\S]*?)(\\n---)`), `$1- **Human Feedback**: ${decision.humanFeedback}\n$2`);
			}

			await writeFile(decisionsPath, content);
		} catch (e) {
			logger.error(e, 'Failed to update decision in file');
		}
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a decision manager
 */
export function createDecisionManager(config: DecisionManagerConfig): DecisionManager {
	return new DecisionManager(config);
}

// ============================================================================
// Re-exports
// ============================================================================

export { classifyDecision, requiresHumanInput, shouldRecord } from './decisionTierClassifier';
export { DecisionAnalyzer, createDecisionAnalyzer } from './decisionAnalyzer';
