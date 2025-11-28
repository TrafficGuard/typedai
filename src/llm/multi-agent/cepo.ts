import { BaseLLM } from '#llm/base-llm';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { type GenerateTextOptions, type LLM, type LlmMessage, type ThinkingLevel, assistant, lastText, user } from '#shared/llm/llm.model';

interface CePOConfig {
	/** Number of responses to be generated in best of n stage */
	bestofn_n: number;
	/** Temperature for verifier in best of n stage (set to 1 for reasoning models) */
	bestofn_temperature: number;
	/** Thinking/reasoning level for rating stage */
	bestofn_thinking: ThinkingLevel;
	/** Type of rating in best of n stage */
	bestofn_rating_type: 'absolute' | 'pairwise' | 'none';
	/** Number of plans generated in planning stage */
	planning_n: number;
	/** Number of attempts to generate n plans in planning stage */
	planning_m: number;
	/** Temperature for planning stages (set to 1 for reasoning models) */
	planning_temperature: number;
	/** Thinking/reasoning level for step 0 (approach generation) */
	planning_thinking_step0: ThinkingLevel;
	/** Thinking/reasoning level for step 1 (plan generation) */
	planning_thinking_step1: ThinkingLevel;
	/** Thinking/reasoning level for step 2 (plan execution) */
	planning_thinking_step2: ThinkingLevel;
	/** Thinking/reasoning level for direct response fallback */
	planning_thinking_direct_resp: ThinkingLevel;
	/** Thinking/reasoning level for step 3 (refinement) */
	planning_thinking_step3: ThinkingLevel;
	/** Thinking/reasoning level for step 4 (final answer) */
	planning_thinking_step4: ThinkingLevel;
	/** Whether to use plan diversity (generates diverse approaches for each completion) */
	use_plan_diversity: boolean;
	/** Whether to print debug output */
	printOutput: boolean;
}

/**
 * Configuration optimized for SOTA reasoning models (minimal calls).
 * Note: Latest SOTA reasoning models (Gemini 2.5, OpenAI o-series, Claude with extended thinking)
 * only support temperature=1 when reasoning is enabled. The LLM implementation handles this.
 */
const sotaConfig: CePOConfig = {
	bestofn_n: 1,
	bestofn_temperature: 1,
	bestofn_thinking: 'high',
	bestofn_rating_type: 'none',
	planning_n: 2,
	planning_m: 4,
	planning_temperature: 1,
	planning_thinking_step0: 'medium',
	planning_thinking_step1: 'high',
	planning_thinking_step2: 'high',
	planning_thinking_direct_resp: 'high',
	planning_thinking_step3: 'high',
	planning_thinking_step4: 'medium',
	use_plan_diversity: false,
	printOutput: false,
};

/** Configuration for fast/cheap models like OpenAI gpt-oss-120B on Cerebras */
const gptOssConfig: CePOConfig = {
	bestofn_n: 3,
	bestofn_temperature: 0.6,
	bestofn_thinking: 'high',
	bestofn_rating_type: 'absolute',
	planning_n: 2,
	planning_m: 4,
	planning_temperature: 1.0,
	planning_thinking_step0: 'medium',
	planning_thinking_step1: 'high',
	planning_thinking_step2: 'high',
	planning_thinking_direct_resp: 'medium',
	planning_thinking_step3: 'high',
	planning_thinking_step4: 'medium',
	use_plan_diversity: false,
	printOutput: true,
};

export { sotaConfig as CePO_SotaConfig, gptOssConfig as CePO_GptOssConfig };

/**
 * The Cerebras Planning and Optimization (CePO) Method
 *
 * CePO is an inference-time computation method designed to enhance the accuracy of large language models (LLMs)
 * on tasks requiring reasoning and planning, such as solving math or coding problems. It integrates several
 * advanced techniques, including Best of N, Chain of Thought (CoT), Self-Reflection, Self-Improvement, and
 * Prompt Engineering.
 *
 * CePO Methodology:
 * In CePO, the Best of N technique is applied to `bestofn_n` solution candidates. Each solution is generated
 * through the following four steps:
 *
 * Step 1: Plan Generation - The model generates a detailed, step-by-step plan to solve the problem, along with
 *         its confidence level for each step.
 *
 * Step 2: Initial Solution - Using the plan from Step 1, the model produces an initial solution.
 *
 * Steps 1 and 2 are repeated `planning_n` times to generate multiple solution proposals. A maximum of
 * `planning_m` attempts is made to generate `planning_n` valid proposals.
 *
 * Step 3: Plan Refinement - The model reviews all generated solution proposals and their associated plans,
 *         identifying inconsistencies. Based on this analysis, a refined, final step-by-step plan is constructed.
 *
 * Step 4: Final Solution - The model uses the refined plan from Step 3 to produce the final answer.
 *
 * @see https://github.com/codelion/optillm/blob/main/optillm/cepo/README.md
 */
export class CePO_LLM extends BaseLLM {
	private llm: LLM;
	private ratingLlm: LLM;

	constructor(
		llmProvider: () => LLM,
		private config: CePOConfig,
		name?: string,
		ratingLlmProvider?: () => LLM,
	) {
		const baseLlm = llmProvider();
		super({
			displayName: name ?? `CePO ${baseLlm.getId()}`,
			service: 'multi',
			modelId: `CePO-${baseLlm.getId()}`,
			maxInputTokens: 128_000,
			calculateCosts: () => ({
				inputCost: 0,
				outputCost: 0,
				totalCost: 0,
			}),
		});
		this.llm = baseLlm;

		// Initialize ratingLlm
		if (ratingLlmProvider) {
			this.ratingLlm = ratingLlmProvider();
			logger.info(`CePO: Using separate rating model ${this.ratingLlm.getId()}`);
		} else {
			this.ratingLlm = this.llm;
		}
	}

	override getModel(): string {
		return this.llm.getId();
	}

	override isConfigured(): boolean {
		return this.llm.isConfigured();
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected override async generateTextFromMessages(initialMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		opts ??= {};

		return withActiveSpan(`CePO id:${opts?.id ?? 'N/A'}`, async () => {
			let approaches: string[] | undefined = undefined;

			const systemMessage = initialMessages.find((m) => m.role === 'system');
			const originalUserQueryText = lastText(initialMessages);
			const questionOnly = this.extractQuestionOnly(originalUserQueryText);

			// Step 0: Generate diverse approaches if enabled
			if (this.config.use_plan_diversity) {
				approaches = await this.generateApproaches(initialMessages, this.config.bestofn_n, opts);
				if (this.config.printOutput && approaches) {
					logger.debug(`CePO: Plan diversity approaches (${approaches.length}):\n${approaches.join('\n')}\n`);
				}
			}

			// Generate all completions in parallel
			if (this.config.printOutput) {
				logger.debug(`CePO: Generating ${this.config.bestofn_n} completions in parallel`);
			}

			const completionPromises = Array.from({ length: this.config.bestofn_n }, (_, i) => {
				const currentApproach = approaches && i < approaches.length ? approaches[i] : undefined;
				if (this.config.printOutput) {
					logger.debug(`CePO: Starting completion ${i + 1} of ${this.config.bestofn_n}`);
				}
				return this.generateCompletion(systemMessage, questionOnly, originalUserQueryText, opts!, currentApproach);
			});

			const completionResults = await Promise.allSettled(completionPromises);

			// Collect successful completions
			const completions: string[] = [];
			for (let i = 0; i < completionResults.length; i++) {
				const result = completionResults[i];
				if (result.status === 'fulfilled' && result.value) {
					completions.push(result.value);
					if (this.config.printOutput) {
						logger.debug(`CePO: Completion ${i + 1} succeeded`);
					}
				} else if (result.status === 'rejected') {
					logger.warn(`CePO: Completion ${i + 1} failed: ${result.reason}`);
				}
			}

			if (completions.length === 0) {
				throw new Error('CePO: All completion attempts failed');
			}

			if (this.config.printOutput) {
				logger.debug(`CePO: Generated ${completions.length} successful completions`);
			}

			// Rate and select the best answer
			const bestAnswer = await this.rateAnswers(completions, initialMessages, opts);
			return bestAnswer;
		});
	}

	/**
	 * Generates diverse high-level approaches for solving the problem.
	 * This is Step 0 when use_plan_diversity is enabled.
	 */
	private async generateApproaches(
		messagesForApproachGen: ReadonlyArray<LlmMessage>,
		numApproaches: number,
		opts?: GenerateTextOptions,
		maxRetry = 2,
	): Promise<string[]> {
		const initialQuery = lastText(messagesForApproachGen);
		const questionOnly = this.extractQuestionOnly(initialQuery);
		const generatedApproaches: string[] = [];

		const approachRequestContent = `To answer the question: "${questionOnly}", please propose ${numApproaches} different high-level approaches to solve the problem. All approaches should be fundamentally different from each other and easily executable without too many steps. Do not include a step-by-step plan or the final answer. You must present the approaches in the following JSON format which is directly loadable:
{
    "approach_1": "<Description of approach 1>",
    "approach_2": "<Description of approach 2>",
    "approach_3": "<Description of approach 3>",
    ...
}`;

		const messages: LlmMessage[] = [...messagesForApproachGen.slice(0, -1), user(approachRequestContent)];

		let retries = 0;
		let responseText = '';
		while (retries < maxRetry) {
			try {
				responseText = await this.llm.generateText(messages, {
					...opts,
					thinking: this.config.planning_thinking_step0,
					temperature: this.config.planning_temperature,
				});

				let jsonString = responseText;
				// Try to extract JSON from markdown code block
				const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
				if (jsonMatch?.[1]) {
					jsonString = jsonMatch[1];
				} else {
					// Fallback: find first '{' and last '}'
					const firstBrace = responseText.indexOf('{');
					const lastBrace = responseText.lastIndexOf('}');
					if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
						jsonString = responseText.substring(firstBrace, lastBrace + 1);
					}
				}

				const parsedOutput = JSON.parse(jsonString);
				for (const key in parsedOutput) {
					if (Object.prototype.hasOwnProperty.call(parsedOutput, key) && typeof parsedOutput[key] === 'string') {
						generatedApproaches.push(parsedOutput[key]);
					}
				}
				if (generatedApproaches.length > 0) break;
				throw new Error('Parsed JSON but no approaches found.');
			} catch (error) {
				logger.warn(
					`CePO: Parsing Error or API error when generating diverse approaches (attempt ${retries + 1}/${maxRetry}): ${(error as Error).message}. Response: ${responseText.substring(0, 200)}`,
				);
			}
			retries++;
		}

		if (generatedApproaches.length === 0) {
			logger.warn('CePO: Max retry attempts reached for generateApproaches, returning empty list.');
		}
		return generatedApproaches;
	}

	/**
	 * Extracts the core question from a task string, removing formatting instructions.
	 */
	private extractQuestionOnly(task: string): string {
		let questionOnly = task.replace('\n## Question: \n\n', '');
		questionOnly = questionOnly.replace(/\n\n\n## Instruction[\s\S]*```json\n{\n {4}"reasoning": "___",\n {4}"answer": "___"\n}\n```/g, '');
		return questionOnly.trim();
	}

	/**
	 * Generates a single completion through the full CePO pipeline (Steps 1-4).
	 */
	private async generateCompletion(
		systemMessage: LlmMessage | undefined,
		questionOnly: string,
		originalUserQueryText: string,
		opts: GenerateTextOptions,
		approach?: string,
	): Promise<string> {
		const executedSolutions: string[] = [];
		let attempts = 0;
		let lastAttemptedSolution: string | undefined;

		// Generate planning_n valid plan+solution pairs in parallel, with up to planning_m total attempts
		const planPromises: Promise<{ index: number; solution: string | null }>[] = [];

		for (let i = 0; i < this.config.planning_m; i++) {
			planPromises.push(
				this.generatePlanAndExecute(systemMessage, questionOnly, opts, approach, i).then((solution) => ({
					index: i,
					solution,
				})),
			);
		}

		// Process results as they complete, stop when we have enough
		const results = await Promise.allSettled(planPromises);

		for (const result of results) {
			if (result.status === 'fulfilled' && result.value.solution) {
				lastAttemptedSolution = result.value.solution;
				executedSolutions.push(result.value.solution);
				attempts++;
				if (this.config.printOutput) {
					logger.debug(
						`CePO: Plan+execution attempt ${result.value.index + 1} succeeded. Got ${executedSolutions.length}/${this.config.planning_n} solutions.`,
					);
				}
				if (executedSolutions.length >= this.config.planning_n) {
					break;
				}
			} else if (result.status === 'rejected') {
				attempts++;
				if (this.config.printOutput) {
					logger.warn(`CePO: Plan+execution attempt failed: ${result.reason}`);
				}
			}
		}

		// Fallback: if no valid solutions, try to answer directly
		if (executedSolutions.length === 0) {
			if (this.config.printOutput) {
				logger.warn('CePO: No valid plan+solution pairs generated. Attempting direct answer fallback.');
			}

			const directAnswer = await this.generateDirectAnswer(systemMessage, questionOnly, opts);
			if (directAnswer) {
				executedSolutions.push(directAnswer);
			} else if (lastAttemptedSolution) {
				logger.warn('CePO: Direct answer failed. Using last attempted solution as fallback.');
				executedSolutions.push(lastAttemptedSolution);
			} else {
				throw new Error('CePO: Failed to generate any solution for this completion path.');
			}
		}

		// Step 3: Refine/consolidate the solutions
		const refinedOutput = await this.refineOutputs(executedSolutions, questionOnly, opts);

		// Step 4: Generate final answer
		return await this.generateFinalAnswer(refinedOutput, originalUserQueryText, opts);
	}

	/**
	 * Generates a plan (Step 1) and executes it (Step 2).
	 * Returns the executed solution or null if failed.
	 */
	private async generatePlanAndExecute(
		systemMessage: LlmMessage | undefined,
		questionOnly: string,
		opts: GenerateTextOptions,
		approach: string | undefined,
		attemptIndex: number,
	): Promise<string | null> {
		try {
			// Step 1: Generate plan
			const planResult = await this.generatePlan(systemMessage, questionOnly, opts, approach);

			// TODO: Check for truncation once LLM framework supports finish_reason
			// For now, we proceed assuming the response is complete

			// Step 2: Execute the plan
			const messagesForExecution: LlmMessage[] = [];
			if (systemMessage) messagesForExecution.push(systemMessage);

			// Reconstruct the plan prompt for conversation history
			let planPromptText: string;
			if (this.config.use_plan_diversity && approach) {
				planPromptText = `To answer this question, can you come up with a concise plan using to solve it step-by-step but do not provide the final answer. Here is the approach you need to follow to generate the plan: ${approach}. Also, for each step, provide your confidence in the correctness of that step as well as your ability to execute it correctly. Here is the question:\n${questionOnly}\nRead the question again:\n\n${questionOnly}`;
			} else {
				planPromptText = `To answer this question, can you come up with a concise plan to solve it step-by-step but do not provide the final answer. Also, for each step, provide your confidence in the correctness of that step as well as your ability to execute it correctly. Here is the question:\n${questionOnly}\nRead the question again:\n\n${questionOnly}`;
			}

			messagesForExecution.push(user(planPromptText));
			messagesForExecution.push(assistant(planResult));

			const solution = await this.executePlan(messagesForExecution, opts);

			if (this.config.printOutput) {
				logger.debug(`CePO: Plan+execute attempt ${attemptIndex + 1} completed successfully`);
			}

			return solution;
		} catch (error) {
			if (this.config.printOutput) {
				logger.warn(`CePO: Plan+execute attempt ${attemptIndex + 1} failed: ${(error as Error).message}`);
			}
			return null;
		}
	}

	/**
	 * Step 1: Generates a detailed plan for solving the problem.
	 */
	private async generatePlan(systemMessage: LlmMessage | undefined, questionOnly: string, opts: GenerateTextOptions, approach?: string): Promise<string> {
		let planPromptText: string;
		if (this.config.use_plan_diversity && approach) {
			planPromptText = `To answer this question, can you come up with a concise plan using to solve it step-by-step but do not provide the final answer. Here is the approach you need to follow to generate the plan: ${approach}. Also, for each step, provide your confidence in the correctness of that step as well as your ability to execute it correctly. Here is the question:\n${questionOnly}\nRead the question again:\n\n${questionOnly}`;
		} else {
			planPromptText = `To answer this question, can you come up with a concise plan to solve it step-by-step but do not provide the final answer. Also, for each step, provide your confidence in the correctness of that step as well as your ability to execute it correctly. Here is the question:\n${questionOnly}\nRead the question again:\n\n${questionOnly}`;
		}

		const messagesForPlan: LlmMessage[] = [];
		if (systemMessage) messagesForPlan.push(systemMessage);
		messagesForPlan.push(user(planPromptText));

		const plan = await this.llm.generateText(messagesForPlan, {
			...opts,
			thinking: this.config.planning_thinking_step1,
			temperature: this.config.planning_temperature,
		});

		if (this.config.printOutput) {
			logger.debug(`CePO: Generated plan: ${plan.substring(0, 200)}...`);
		}

		return plan;
	}

	/**
	 * Step 2: Executes the plan to produce an initial solution.
	 */
	private async executePlan(messagesWithPlan: LlmMessage[], opts: GenerateTextOptions): Promise<string> {
		const executePromptText =
			'Can you execute the above plan step-by-step to produce the final answer. Be extra careful when executing steps where your confidence is lower.';

		const messagesForExecute: LlmMessage[] = [...messagesWithPlan, user(executePromptText)];

		const solution = await this.llm.generateText(messagesForExecute, {
			...opts,
			thinking: this.config.planning_thinking_step2,
			temperature: this.config.planning_temperature,
		});

		if (this.config.printOutput) {
			logger.debug(`CePO: Execution result: ${solution.substring(0, 200)}...`);
		}

		return solution;
	}

	/**
	 * Fallback: Attempts to answer the question directly without the plan+execute flow.
	 * Used when all plan generation attempts fail.
	 */
	private async generateDirectAnswer(systemMessage: LlmMessage | undefined, questionOnly: string, opts: GenerateTextOptions): Promise<string | null> {
		try {
			const messages: LlmMessage[] = [];
			if (systemMessage) messages.push(systemMessage);
			messages.push(user(questionOnly));

			const response = await this.llm.generateText(messages, {
				...opts,
				thinking: this.config.planning_thinking_direct_resp,
				temperature: this.config.planning_temperature,
			});

			if (this.config.printOutput) {
				logger.debug(`CePO: Direct answer fallback succeeded: ${response.substring(0, 200)}...`);
			}

			return response;
		} catch (error) {
			logger.error(`CePO: Direct answer fallback failed: ${(error as Error).message}`);
			return null;
		}
	}

	/**
	 * Step 3: Reviews and consolidates multiple solutions, identifying inconsistencies.
	 */
	private async refineOutputs(executedSolutions: string[], questionOnly: string, opts: GenerateTextOptions): Promise<string> {
		if (executedSolutions.length === 0) {
			throw new Error('CePO: Cannot refine with no solutions.');
		}

		// If only one solution, skip refinement
		if (executedSolutions.length === 1) {
			if (this.config.printOutput) {
				logger.debug('CePO: Only one solution, skipping refinement step');
			}
			return executedSolutions[0];
		}

		const combinedSolutionsText = executedSolutions.map((out, index) => `Response ${index + 1}:\n${out}`).join('\n\n');

		const refinePromptText = `Can you review your last ${executedSolutions.length} responses and identify any inconsistency between them. After that, can you address it and present a final step-by-step solution to the problem? Here is the question:\n${questionOnly}`;

		const messagesForRefinement: LlmMessage[] = [assistant(combinedSolutionsText), user(refinePromptText)];

		try {
			const refined = await this.llm.generateText(messagesForRefinement, {
				...opts,
				thinking: this.config.planning_thinking_step3,
				temperature: this.config.planning_temperature,
			});

			if (this.config.printOutput) {
				logger.debug(`CePO: Refined output: ${refined.substring(0, 200)}...`);
			}

			return refined;
		} catch (error) {
			logger.error(`CePO: Error during output refinement: ${(error as Error).message}. Falling back to the first solution.`);
			return executedSolutions[0];
		}
	}

	/**
	 * Step 4: Uses the refined solution to produce the final answer.
	 */
	private async generateFinalAnswer(refinedOutput: string, originalTaskText: string, opts: GenerateTextOptions): Promise<string> {
		const finalAnswerPromptText = `Use your final solution from above to correctly answer the question. Here is the question:\n${originalTaskText}`;

		const messagesForFinalAnswer: LlmMessage[] = [assistant(refinedOutput), user(finalAnswerPromptText)];

		const finalAnswer = await this.llm.generateText(messagesForFinalAnswer, {
			...opts,
			thinking: this.config.planning_thinking_step4,
			temperature: this.config.planning_temperature,
		});

		if (this.config.printOutput) {
			logger.debug(`CePO: Final Answer generated: ${finalAnswer.substring(0, 200)}...`);
		}

		return finalAnswer;
	}

	/**
	 * Rates completions and selects the best one based on the configured rating type.
	 */
	private async rateAnswers(answers: string[], initialMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		if (answers.length === 0) {
			throw new Error('CePO: No answers to rate.');
		}

		if (answers.length === 1) {
			return answers[0];
		}

		if (this.config.bestofn_rating_type === 'none') {
			// For SOTA models or when rating is disabled: return the last answer
			// (which has gone through the full refinement pipeline)
			if (this.config.printOutput) {
				logger.debug('CePO: Rating disabled, returning last completion');
			}
			return answers[answers.length - 1];
		}

		if (this.config.bestofn_rating_type === 'absolute') {
			return this.rateAnswersAbsolute(answers, initialMessages, opts);
		}

		if (this.config.bestofn_rating_type === 'pairwise') {
			return this.rateAnswersPairwise(answers, initialMessages, opts);
		}

		throw new Error(`CePO: Invalid rating type: ${this.config.bestofn_rating_type}`);
	}

	/**
	 * Rates each answer independently on a 0/1 scale (incorrect/correct).
	 */
	private async rateAnswersAbsolute(answers: string[], initialMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		const originalSystemMessage = initialMessages.find((m) => m.role === 'system');
		const originalUserQueryMessage = initialMessages.filter((m) => m.role === 'user').at(-1);

		if (!originalUserQueryMessage) {
			logger.error('CePO: Cannot perform absolute rating without original user query.');
			return answers[0];
		}

		const ratingPreamble = `Please act as an impartial judge and evaluate the accuracy of the response provided by an AI assistant to the user question displayed below. Your evaluation should consider only correctness and accuracy as the primary factor.
Evaluation Criteria:
- Correctness: How free is it from errors or mistakes?
- Accuracy: Are the information and explanations factually correct?
Evaluation Process:
1. Carefully review the user question and the AI assistant's response.
2. Assess the response for any inaccuracies in reasoning as well as execution.
3. Provide a detailed explanation of your step-by-step evaluation.
4. Identify if the final answer is correct or not.
Begin your evaluation by thinking through the given problem and response step-by-step.
VERY IMPORTANT: Re-do any calculations present and check if you arrive at the same answer.
Thoroughly check for any inaccuracies in reasoning and calculations for each step.
Be as objective as possible. After providing your detailed explanation, please rate the response as 0 or 1, (0 for incorrect and 1 for correct) by strictly following this format: "Rating: [[rating]]", for example: "Rating: [[0]]"`;

		const effectiveSystemContent = originalSystemMessage ? `${originalSystemMessage.content}\n\n${ratingPreamble}` : ratingPreamble;

		// Rate all answers in parallel
		const ratingPromises = answers.map(async (answer, index) => {
			const messagesForRating: LlmMessage[] = [
				{ role: 'system', content: effectiveSystemContent },
				originalUserQueryMessage,
				assistant(answer),
				user(
					'Rate the above response beginning with the detailed explanation followed by a rating of 0 or 1 by strictly following this format: "Explanation: <reason for your rating>\\n\\nRating: [[rating]]".',
				),
			];

			try {
				const ratingResponseText = await this.ratingLlm.generateText(messagesForRating, {
					...opts,
					thinking: this.config.bestofn_thinking,
					temperature: this.config.bestofn_temperature,
				});

				if (this.config.printOutput) {
					logger.debug(`CePO Absolute Rating: Response for answer ${index + 1}: ${ratingResponseText.substring(0, 200)}...`);
				}

				const ratingMatch = ratingResponseText.match(/Rating: \[\[([01])\]\]/);
				return ratingMatch ? Number.parseInt(ratingMatch[1], 10) : -1;
			} catch (error) {
				logger.error(`CePO Absolute Rating: Error rating answer ${index + 1}: ${(error as Error).message}`);
				return -1;
			}
		});

		const ratings = await Promise.all(ratingPromises);

		if (this.config.printOutput) {
			logger.debug(`CePO Absolute Ratings: ${ratings.join(', ')}`);
		}

		let bestAnswerIndex = ratings.indexOf(Math.max(...ratings));
		if (bestAnswerIndex === -1 || (ratings[bestAnswerIndex] === -1 && ratings.every((r) => r === -1))) {
			logger.warn('CePO Absolute Rating: All ratings were -1 or no valid ratings. Defaulting to the first answer.');
			bestAnswerIndex = 0;
		}

		return answers[bestAnswerIndex];
	}

	/**
	 * Rates answers pairwise, comparing each pair head-to-head.
	 */
	private async rateAnswersPairwise(answers: string[], initialMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		const numAnswers = answers.length;
		const ratings: number[] = new Array(numAnswers).fill(0);

		const originalSystemMessage = initialMessages.find((m) => m.role === 'system');
		const originalUserQueryMessage = initialMessages.filter((m) => m.role === 'user').at(-1);

		if (!originalUserQueryMessage) {
			logger.error('CePO: Cannot perform pairwise rating without original user query.');
			return answers[0];
		}

		const pairwiseSystemInstructions = `Please act as an impartial judge and compare the quality of the two responses provided by the AI assistant to the user's question displayed below. Evaluation Criteria:
- Helpfulness: How effectively does the response meet the user's needs?
- Relevance: How directly does the response address the original question?
- Accuracy: Are the information and explanations factually correct?
- Depth: Does the response provide comprehensive and meaningful insights?
- Creativity: Does the response offer unique or innovative perspectives?
- Clarity: Is the response well-organized, coherent, and easy to understand?
Evaluation Process:
1. Carefully review the user's question and the AI assistant's responses.
2. Compare the responses against each other for each criterion.
3. Provide a concise explanation of your overall evaluation.
4. Select the response that is superior based on the above criteria.
Reply with "Better Response: [[response id]]".
If the first response is better, reply with "Better Response: [[0]]".
If the second response is better, reply with "Better Response: [[1]]".`;

		// Generate all pairs: [(0,1), (0,2), (1,0), (1,2), (2,0), (2,1), ...]
		const pairs: [number, number][] = [];
		for (let i = 0; i < numAnswers; i++) {
			for (let j = 0; j < numAnswers; j++) {
				if (i !== j) {
					pairs.push([i, j]);
				}
			}
		}

		// Rate all pairs in parallel
		const pairRatingPromises = pairs.map(async ([idx1, idx2]) => {
			const responsesPairText = `Response 0: ${answers[idx1]}\n\nResponse 1: ${answers[idx2]}`;

			const messagesForPairRating: LlmMessage[] = [];
			if (originalSystemMessage) messagesForPairRating.push(originalSystemMessage);
			messagesForPairRating.push(originalUserQueryMessage);
			messagesForPairRating.push({ role: 'system', content: pairwiseSystemInstructions });
			messagesForPairRating.push(assistant(responsesPairText));
			messagesForPairRating.push({
				role: 'system',
				content:
					'Reply with "Better Response: [[response id]]". If the first response is better, reply with "Better Response: [[0]]". If the second response is better, reply with "Better Response: [[1]]".',
			});

			try {
				const ratingResponseText = await this.ratingLlm.generateText(messagesForPairRating, {
					...opts,
					thinking: this.config.bestofn_thinking,
					temperature: this.config.bestofn_temperature,
				});

				if (this.config.printOutput) {
					logger.debug(`CePO Pairwise Rating: Response for pair (${idx1}, ${idx2}): ${ratingResponseText.substring(0, 200)}...`);
				}

				const match = ratingResponseText.match(/Better Response: \[\[([01])\]\]/);
				if (match) {
					const winnerInPair = Number.parseInt(match[1], 10);
					return { winner: winnerInPair === 0 ? idx1 : idx2 };
				}
				// Default to first response in pair if parsing fails
				return { winner: idx1 };
			} catch (error) {
				logger.error(`CePO Pairwise Rating: Error rating pair (${idx1}, ${idx2}): ${(error as Error).message}`);
				return { winner: idx1 };
			}
		});

		const pairResults = await Promise.all(pairRatingPromises);

		// Tally up the wins
		for (const result of pairResults) {
			ratings[result.winner]++;
		}

		if (this.config.printOutput) {
			logger.debug(`CePO Pairwise Ratings: ${ratings.join(', ')}`);
		}

		let bestAnswerIndex = ratings.indexOf(Math.max(...ratings));
		if (bestAnswerIndex === -1) bestAnswerIndex = 0;

		return answers[bestAnswerIndex];
	}
}
