/**
 * Decision Analyzer
 *
 * Uses AI to analyze medium-tier decisions to determine if there's
 * a clear winner before triggering parallel exploration.
 */

import { logger } from '#o11y/logger';
import type { LLM } from '#shared/agent/agent.model';
import type { KnowledgeBase, Learning } from '../learning/knowledgeBase';
import type { Decision, DecisionTier, OptionDefinition } from '../orchestrator/milestone';

// ============================================================================
// Analysis Types
// ============================================================================

/**
 * Input for decision analysis
 */
export interface DecisionAnalysisInput {
	/** The question being decided */
	question: string;
	/** Available options */
	options: OptionDefinition[];
	/** Context about the codebase/task */
	context: string;
	/** Affected files/areas */
	affectedAreas: string[];
	/** Current task description */
	taskDescription: string;
}

/**
 * Result of AI decision analysis
 */
export interface DecisionAnalysisResult {
	/** Whether there's a clear winner */
	hasClearWinner: boolean;
	/** The recommended option (if clear winner) */
	recommendedOption?: string;
	/** Confidence in the recommendation (0-1) */
	confidence: number;
	/** Detailed reasoning */
	reasoning: string;
	/** Pros/cons for each option */
	optionAnalysis: OptionAnalysis[];
	/** Knowledge base learnings that influenced the decision */
	relevantLearnings: Learning[];
	/** Whether parallel exploration is recommended */
	recommendParallel: boolean;
}

/**
 * Analysis of a single option
 */
export interface OptionAnalysis {
	optionId: string;
	optionName: string;
	pros: string[];
	cons: string[];
	alignmentScore: number; // 0-1, how well it aligns with codebase patterns
	effortEstimate: 'low' | 'medium' | 'high';
	riskLevel: 'low' | 'medium' | 'high';
}

// ============================================================================
// Analyzer Configuration
// ============================================================================

export interface DecisionAnalyzerConfig {
	/** LLM to use for analysis */
	llm: LLM;
	/** Knowledge base for code patterns */
	knowledgeBase: KnowledgeBase;
	/** Minimum confidence to declare a clear winner */
	clearWinnerThreshold: number;
	/** Maximum confidence difference between options to recommend parallel */
	parallelThreshold: number;
}

const DEFAULT_CONFIG: Partial<DecisionAnalyzerConfig> = {
	clearWinnerThreshold: 0.75,
	parallelThreshold: 0.15,
};

// ============================================================================
// Decision Analyzer
// ============================================================================

/**
 * Analyzes decisions using AI and knowledge base
 */
export class DecisionAnalyzer {
	private config: DecisionAnalyzerConfig;

	constructor(config: DecisionAnalyzerConfig) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Analyzes a decision to determine if there's a clear winner
	 */
	async analyze(input: DecisionAnalysisInput): Promise<DecisionAnalysisResult> {
		logger.info({ question: input.question.slice(0, 50) }, 'Analyzing decision');

		// Step 1: Retrieve relevant learnings from knowledge base
		const learnings = await this.getRelevantLearnings(input);

		// Step 2: Build analysis prompt
		const prompt = this.buildAnalysisPrompt(input, learnings);

		// Step 3: Get LLM analysis
		const llmResult = await this.getLLMAnalysis(prompt);

		// Step 4: Parse and validate result
		const result = this.parseAnalysisResult(llmResult, learnings);

		// Step 5: Determine recommendation
		return this.finalizeResult(result, input.options);
	}

	/**
	 * Quick check if decision likely has a clear winner (without full analysis)
	 */
	async quickCheck(input: DecisionAnalysisInput): Promise<boolean> {
		// Check knowledge base for strong preferences
		const learnings = await this.getRelevantLearnings(input);

		// If we have strong preference learnings, likely has clear winner
		const strongPreferences = learnings.filter((l) => l.type === 'preference' && l.confidence >= 0.8);

		if (strongPreferences.length > 0) {
			// Check if any option matches the preferences
			for (const option of input.options) {
				for (const pref of strongPreferences) {
					if (this.optionMatchesLearning(option, pref)) {
						return true;
					}
				}
			}
		}

		// Otherwise, need full analysis
		return false;
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Retrieves relevant learnings from knowledge base
	 */
	private async getRelevantLearnings(input: DecisionAnalysisInput): Promise<Learning[]> {
		const query = {
			text: `${input.question} ${input.options.map((o) => o.description).join(' ')}`,
			types: ['pattern', 'preference', 'pitfall'] as ('pattern' | 'preference' | 'pitfall')[],
			minConfidence: 0.6,
			limit: 15,
		};

		return this.config.knowledgeBase.retrieve(query);
	}

	/**
	 * Builds the analysis prompt for the LLM
	 */
	private buildAnalysisPrompt(input: DecisionAnalysisInput, learnings: Learning[]): string {
		const learningsStr =
			learnings.length > 0
				? learnings.map((l) => `- [${l.type}] ${l.content} (confidence: ${(l.confidence * 100).toFixed(0)}%)`).join('\n')
				: 'No specific learnings available.';

		const optionsStr = input.options
			.map((o) => `### Option: ${o.name}\n${o.description}\n**Pros**: ${o.pros.join(', ')}\n**Cons**: ${o.cons.join(', ')}`)
			.join('\n\n');

		return `
# Decision Analysis Request

## Task Context
${input.taskDescription}

## Decision Question
${input.question}

## Available Options
${optionsStr}

## Affected Areas
${input.affectedAreas.join(', ') || 'Not specified'}

## Codebase Context
${input.context}

## Relevant Code Patterns & Preferences (from Knowledge Base)
${learningsStr}

---

# Analysis Instructions

Please analyze this decision and determine:

1. **Option Analysis**: For each option, evaluate:
   - Alignment with existing codebase patterns (0-10 score)
   - Effort to implement (low/medium/high)
   - Risk level (low/medium/high)
   - Additional pros and cons not listed

2. **Recommendation**:
   - Is there a clear winner? (one option significantly better than others)
   - If yes, which option and why?
   - If no, explain why parallel exploration would be valuable

3. **Confidence**: Rate your confidence in the recommendation (0-100%)

## Response Format

Respond in the following JSON format:
\`\`\`json
{
  "optionAnalysis": [
    {
      "optionId": "option-id",
      "optionName": "Option Name",
      "alignmentScore": 8,
      "effortEstimate": "medium",
      "riskLevel": "low",
      "additionalPros": ["pro1", "pro2"],
      "additionalCons": ["con1"]
    }
  ],
  "hasClearWinner": true,
  "recommendedOption": "option-id",
  "confidence": 85,
  "reasoning": "Detailed explanation...",
  "recommendParallel": false
}
\`\`\`
`;
	}

	/**
	 * Gets analysis from LLM
	 */
	private async getLLMAnalysis(prompt: string): Promise<string> {
		try {
			const response = await this.config.llm.generateText([{ role: 'user', content: prompt }], {
				id: 'decision-analysis',
				temperature: 0.3, // Low temperature for consistent analysis
			});
			return response;
		} catch (e) {
			logger.error(e, 'Failed to get LLM analysis');
			throw e;
		}
	}

	/**
	 * Parses the LLM analysis result
	 */
	private parseAnalysisResult(llmResult: string, learnings: Learning[]): Omit<DecisionAnalysisResult, 'recommendParallel'> & { recommendParallel?: boolean } {
		try {
			// Extract JSON from response
			const jsonMatch = llmResult.match(/```json\n?([\s\S]*?)\n?```/);
			if (!jsonMatch) {
				throw new Error('No JSON found in response');
			}

			const parsed = JSON.parse(jsonMatch[1]);

			// Build option analysis
			const optionAnalysis: OptionAnalysis[] = (parsed.optionAnalysis || []).map((oa: any) => ({
				optionId: oa.optionId,
				optionName: oa.optionName,
				pros: [...(oa.additionalPros || [])],
				cons: [...(oa.additionalCons || [])],
				alignmentScore: (oa.alignmentScore || 5) / 10, // Normalize to 0-1
				effortEstimate: oa.effortEstimate || 'medium',
				riskLevel: oa.riskLevel || 'medium',
			}));

			return {
				hasClearWinner: parsed.hasClearWinner ?? false,
				recommendedOption: parsed.recommendedOption,
				confidence: (parsed.confidence ?? 50) / 100, // Normalize to 0-1
				reasoning: parsed.reasoning || 'No reasoning provided',
				optionAnalysis,
				relevantLearnings: learnings,
				recommendParallel: parsed.recommendParallel,
			};
		} catch (e) {
			logger.warn(e, 'Failed to parse LLM analysis result');

			// Return default uncertain result
			return {
				hasClearWinner: false,
				confidence: 0.5,
				reasoning: 'Failed to parse analysis result',
				optionAnalysis: [],
				relevantLearnings: learnings,
			};
		}
	}

	/**
	 * Finalizes the analysis result with recommendation
	 */
	private finalizeResult(
		partialResult: Omit<DecisionAnalysisResult, 'recommendParallel'> & { recommendParallel?: boolean },
		options: OptionDefinition[],
	): DecisionAnalysisResult {
		const { hasClearWinner, confidence, optionAnalysis } = partialResult;

		// Determine if parallel exploration should be recommended
		let recommendParallel = partialResult.recommendParallel ?? false;

		if (!hasClearWinner) {
			// No clear winner - check if options are close
			if (optionAnalysis.length >= 2) {
				const scores = optionAnalysis.map((oa) => oa.alignmentScore).sort((a, b) => b - a);
				const scoreDiff = scores[0] - scores[1];

				if (scoreDiff <= this.config.parallelThreshold) {
					recommendParallel = true;
				}
			} else {
				recommendParallel = true;
			}
		} else if (confidence < this.config.clearWinnerThreshold) {
			// Has "clear winner" but low confidence - still recommend parallel
			recommendParallel = true;
		}

		return {
			...partialResult,
			recommendParallel,
		};
	}

	/**
	 * Checks if an option matches a learning
	 */
	private optionMatchesLearning(option: OptionDefinition, learning: Learning): boolean {
		const optionText = `${option.name} ${option.description}`.toLowerCase();
		const learningText = learning.content.toLowerCase();

		// Simple keyword matching
		const keywords = learningText.split(/\s+/).filter((w) => w.length > 4);
		const matches = keywords.filter((kw) => optionText.includes(kw));

		return matches.length >= 2;
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a decision analyzer with the given configuration
 */
export function createDecisionAnalyzer(llm: LLM, knowledgeBase: KnowledgeBase, options: Partial<DecisionAnalyzerConfig> = {}): DecisionAnalyzer {
	return new DecisionAnalyzer({
		llm,
		knowledgeBase,
		clearWinnerThreshold: options.clearWinnerThreshold ?? 0.75,
		parallelThreshold: options.parallelThreshold ?? 0.15,
	});
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Converts a simple string array of options to OptionDefinitions
 */
export function stringsToOptionDefinitions(options: string[]): OptionDefinition[] {
	return options.map((opt, i) => ({
		id: `option-${i + 1}`,
		name: `Option ${i + 1}`,
		description: opt,
		pros: [],
		cons: [],
	}));
}

/**
 * Builds a decision from analysis result
 */
export function buildDecisionFromAnalysis(
	question: string,
	options: string[],
	result: DecisionAnalysisResult,
	subtaskId?: string,
): Omit<Decision, 'id' | 'timestamp'> {
	return {
		tier: result.hasClearWinner ? 'medium' : 'medium', // Still medium even if parallel
		question,
		options,
		chosenOption: result.recommendedOption ?? options[0],
		reasoning: result.reasoning,
		madeBy: 'agent',
		reviewStatus: 'pending',
		subtaskId,
	};
}
