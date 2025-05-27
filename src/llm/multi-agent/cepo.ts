import { BaseLLM } from '#llm/base-llm';
import { Claude4_Opus_Vertex } from '#llm/services/anthropic-vertex';
import { cerebrasLlama3_3_70b, cerebrasQwen3_32b } from '#llm/services/cerebras';
import { openAIo3 } from '#llm/services/openai';
import { vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { type GenerateTextOptions, type LLM, type LlmMessage, assistant, lastText, user } from '#shared/model/llm.model';

interface CePOConfig {
	bestofn_n: number;
	bestofn_temperature: number;
	bestofn_max_tokens: number;
	bestofn_rating_type: 'absolute' | 'pairwise';
	planning_n: number;
	planning_m: number;
	planning_temperature_step0: number;
	planning_max_tokens_step0: number;
	planning_temperature_step1: number;
	planning_temperature_step2: number;
	planning_temperature_step3: number;
	planning_temperature_step4: number;
	planning_max_tokens_step1: number;
	planning_max_tokens_step2: number;
	planning_max_tokens_step3: number;
	planning_max_tokens_step4: number;
	use_plan_diversity: boolean;
	rating_model_id?: string;
	printOutput: boolean;
}

const limitedConfig: CePOConfig = {
	bestofn_n: 3,
	bestofn_temperature: 0.1,
	bestofn_max_tokens: 4096,
	bestofn_rating_type: 'absolute',
	planning_n: 3,
	planning_m: 6,
	planning_temperature_step0: 0.7,
	planning_max_tokens_step0: 1024,
	planning_temperature_step1: 0.55,
	planning_temperature_step2: 0.25,
	planning_temperature_step3: 0.1,
	planning_temperature_step4: 0,
	planning_max_tokens_step1: 4096,
	planning_max_tokens_step2: 4096,
	planning_max_tokens_step3: 4096,
	planning_max_tokens_step4: 4096,
	use_plan_diversity: false,
	// rating_model_id: undefined, // Default: use the main LLM for rating
	printOutput: false,
};

const sotaConfig: CePOConfig = {
	bestofn_n: 3,
	bestofn_temperature: 0.1,
	bestofn_max_tokens: 16_000,
	bestofn_rating_type: 'absolute',
	planning_n: 3,
	planning_m: 6,
	planning_temperature_step0: 0.7,
	planning_max_tokens_step0: 16_000,
	planning_temperature_step1: 0.55,
	planning_temperature_step2: 0.25,
	planning_temperature_step3: 0.1,
	planning_temperature_step4: 0,
	planning_max_tokens_step1: 16_000,
	planning_max_tokens_step2: 16_000,
	planning_max_tokens_step3: 16_000,
	planning_max_tokens_step4: 16_000,
	use_plan_diversity: false,
	// rating_model_id: undefined, // Default: use the main LLM for rating
	printOutput: false,
};

const o3 = openAIo3();
const gemini_2_5_Pro = vertexGemini_2_5_Pro();
const opus4 = Claude4_Opus_Vertex();

//  https://github.com/codelion/optillm/blob/main/optillm/cepo/README.md

export function CePO_Cerebras_Qwen3_32b(llmProvider: () => LLM = () => cerebrasLlama3_3_70b(), name?: string): LLM {
	return new CePO_LLM(() => cerebrasQwen3_32b(), 'CePO (Qwen3 32b Cerebras)', limitedConfig);
}

/**
 * The Cerebras Planning and Optimization (CePO) Method
 *
 * CePO is an inference-time computation method designed to enhance the accuracy of large language models (LLMs) on tasks requiring reasoning and planning, such as solving math or coding problems. It integrates several advanced techniques, including Best of N, Chain of Thought (CoT), Self-Reflection, Self-Improvement, and Prompt Engineering.
 *
 * If you have any questions or want to contribute, please reach out to us on cerebras.ai/discord
 *
 * CePO Methodology
 *
 * In CePO, the Best of N technique is applied to bestofn_n solution candidates. Each solution is generated through the following four steps:
 *
 * Step 1: Plan Generation The model generates a detailed, step-by-step plan to solve the problem, along with its confidence level for each step.
 *
 * Step 2: Initial Solution Using the plan from Step 1, the model produces an initial solution.
 *
 * Steps 1 and 2 are repeated planning_n times to generate multiple solution proposals. If the model exceeds the token budget during Step 1 or 2, the plan/solution is marked as incomplete, rejected, and regenerated. A maximum of planning_m attempts is made to generate planning_n valid proposals.
 *
 * Step 3: Plan Refinement The model reviews all generated solution proposals and their associated plans, identifying inconsistencies. Based on this analysis, a refined, final step-by-step plan is constructed.
 *
 * Step 4: Final Solution The model uses the refined plan from Step 3 to produce the final answer.
 * @constructor
 */
export class CePO_LLM extends BaseLLM {
	llm: LLM;
	ratingLlm: LLM; // Added

	/**
	 * @param llmProvider
	 * @param name
	 * @param config
	 */
	constructor(
		llmProvider: () => LLM,
		name: string,
		private config: CePOConfig /*, ratingLlmResolver?: (id: string) => LLM */,
	) {
		const baseLlm = llmProvider(); // Call once
		super(name ?? `CePO ${baseLlm.getId()}`, 'multi', `CePO-${baseLlm.getId()}`, 128_000, () => ({ inputCost: 0, outputCost: 0, totalCost: 0 }));
		this.llm = baseLlm;

		// Initialize ratingLlm
		if (this.config.rating_model_id /* && ratingLlmResolver */) {
			try {
				// this.ratingLlm = ratingLlmResolver(this.config.rating_model_id);
				// logger.info(`CePO: Using rating model ${this.config.rating_model_id}`);
				// For now, without a resolver, default to baseLlm if rating_model_id is set but no resolver
				this.ratingLlm = this.llm;
				logger.warn(`CePO: rating_model_id '${this.config.rating_model_id}' is set, but no resolver provided. Defaulting to primary LLM for ratings.`);
			} catch (error) {
				logger.warn(`CePO: Failed to get rating model ${this.config.rating_model_id}. Defaulting to primary LLM. Error: ${(error as Error).message}`);
				this.ratingLlm = this.llm;
			}
		} else {
			this.ratingLlm = this.llm;
		}
	}

	getModel(): string {
		return this.llm.getId();
	}

	isConfigured(): boolean {
		return this.llm.isConfigured();
	}

	protected supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected async generateTextFromMessages(initialMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		return withActiveSpan(`CePO id:${opts?.id ?? 'N/A'}`, async () => {
			const completions: string[] = [];
			let approaches: string[] | undefined = undefined;

			const systemPromptMessage = initialMessages.find((m) => m.role === 'system');
			const userQueryMessage = initialMessages.find((m) => m.role === 'user' && m === initialMessages.at(-1)); // Assuming last message is the main user query

			if (this.config.use_plan_diversity) {
				if (!userQueryMessage) {
					logger.warn('CePO: use_plan_diversity is true, but could not find the main user query message to generate approaches.');
				} else {
					const messagesForApproaches: LlmMessage[] = [];
					if (systemPromptMessage) messagesForApproaches.push(systemPromptMessage);
					messagesForApproaches.push(userQueryMessage); // Pass only system and user query for approach generation

					approaches = await this.generateApproaches(messagesForApproaches, this.config.bestofn_n, opts);
					if (this.config.printOutput && approaches) {
						logger.debug(`CePO: Plan diversity approaches (${approaches.length}):\n${approaches.join('\n')}\n`);
					}
				}
			}

			for (let i = 0; i < this.config.bestofn_n; i++) {
				if (this.config.printOutput) {
					logger.debug(`\nCePO: Generating completion ${i + 1} out of ${this.config.bestofn_n} \n`);
				}
				const currentApproach = approaches && i < approaches.length ? approaches[i] : undefined;
				if (this.config.use_plan_diversity && approaches && i >= approaches.length && approaches.length > 0 && approaches.length < this.config.bestofn_n) {
					logger.warn(
						`CePO: Not enough diverse approaches generated (${approaches.length}) for bestofn_n (${this.config.bestofn_n}). Re-using last available approach or no approach for completion ${i + 1}.`,
					);
				}

				// Pass initialMessages for context, generateCompletion will internally manage history for its steps
				const completion = await this.generateCompletion(initialMessages, opts, currentApproach);
				completions.push(completion);
			}

			const bestAnswer = await this.rateAnswers(completions, initialMessages, opts);
			return bestAnswer;
		});
	}

	private async generateApproaches(
		messagesForApproachGen: ReadonlyArray<LlmMessage>, // Should contain [system_prompt_msg, user_initial_query_msg]
		numApproaches: number,
		opts?: GenerateTextOptions,
		maxRetry = 2,
	): Promise<string[]> {
		const initialQuery = lastText(messagesForApproachGen); // Assumes last message is user query
		const questionOnly = this.extractQuestionOnly(initialQuery);
		const generatedApproaches: string[] = [];

		const approachRequestContent = `To answer the question: "${questionOnly}", please propose ${numApproaches} different high-level approaches to solve the problem. All approaches should be fundamentally different from each other and easily executable without too many steps. Do not include a step-by-step plan or the final answer. You must present the approaches in the following JSON format which is directly loadable:
{
    "approach_1": "<Description of approach 1>",
    "approach_2": "<Description of approach 2>",
    "approach_3": "<Description of approach 3>",
    ...
}`;
		// Python: messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": content}]
		// We receive messagesForApproachGen which should be [system, user_query]. We replace user_query with approachRequestContent.
		const messages: LlmMessage[] = [...messagesForApproachGen.slice(0, -1), user(approachRequestContent)];

		let retries = 0;
		let responseText = '';
		while (retries < maxRetry) {
			try {
				responseText = await this.llm.generateText(messages, {
					...opts,
					maxOutputTokens: this.config.planning_max_tokens_step0,
					temperature: this.config.planning_temperature_step0,
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
				// Python's cleaning: .replace('\\', '\\\\').replace('json','').replace("```", "")
				// The regex handles ```json, and JSON.parse handles escapes.

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
					`CePO: Parsing Error or API error when generating diverse approaches (attempt ${retries + 1}/${maxRetry}): ${(error as Error).message}. Response: ${responseText}`,
				);
			}
			retries++;
		}

		if (generatedApproaches.length === 0) {
			logger.warn('CePO: Max retry attempts reached for generateApproaches or no approaches extracted, returning empty list.');
		}
		return generatedApproaches;
	}

	private extractQuestionOnly(task: string): string {
		let questionOnly = task.replace('\n## Question: \n\n', '');
		questionOnly = questionOnly.replace(/\n\n\n## Instruction[\s\S]*```json\n{\n {4}"reasoning": "___",\n {4}"answer": "___"\n}\n```/g, '');
		return questionOnly.trim();
	}

	// In CePO_LLM class

	private async generatePlan(
		systemMessage: LlmMessage | undefined,
		questionOnly: string, // Extracted from original user query
		opts: GenerateTextOptions | undefined,
		approach?: string,
	): Promise<{ plan: string; truncated: boolean }> {
		let planPromptText: string;
		if (this.config.use_plan_diversity && approach) {
			planPromptText = `To answer this question, can you come up with a concise plan using to solve it step-by-step but do not provide the final answer. Here is the approach you need to follow to generate the plan: ${approach}. Also, for each step, provide your confidence in the correctness of that step as well as your ability to execute it correctly. Here is the question:\n${questionOnly}\nRead the question again:\n\n${questionOnly}`;
		} else {
			planPromptText = `To answer this question, can you come up with a concise plan to solve it step-by-step but do not provide the final answer. Also, for each step, provide your confidence in the correctness of that step as well as your ability to execute it correctly. Here is the question:\n${questionOnly}\nRead the question again:\n\n${questionOnly}`;
		}

		const messagesForPlan: LlmMessage[] = [];
		if (systemMessage) messagesForPlan.push(systemMessage);
		messagesForPlan.push(user(planPromptText));

		// Use generateMessage to access stats for truncation check
		const response = await this.llm.generateMessage(messagesForPlan, {
			...opts,
			temperature: this.config.planning_temperature_step1,
			maxOutputTokens: this.config.planning_max_tokens_step1,
		});
		const plan = lastText([response]); // Assuming lastText works with generateMessage's output structure
		const truncated = (response.stats?.outputTokens ?? 0) >= this.config.planning_max_tokens_step1 * 0.98; // Check if near limit

		if (this.config.printOutput) logger.debug(`CePO: Generated plan (truncated: ${truncated}): ${plan.substring(0, 200)}...`);
		return { plan, truncated };
	}

	private async executePlan(
		messagesSoFar: ReadonlyArray<LlmMessage>, // [system?, user_plan_prompt, assistant_plan]
		opts: GenerateTextOptions | undefined,
	): Promise<{ solution: string; truncated: boolean }> {
		const executePromptText =
			'Can you execute the above plan step-by-step to produce the final answer. Be extra careful when executing steps where your confidence is lower.';
		const messagesForExecute: LlmMessage[] = [...messagesSoFar, user(executePromptText)];

		const response = await this.llm.generateMessage(messagesForExecute, {
			...opts,
			temperature: this.config.planning_temperature_step2,
			maxOutputTokens: this.config.planning_max_tokens_step2,
		});
		const solution = lastText([response]);
		const truncated = (response.stats?.outputTokens ?? 0) >= this.config.planning_max_tokens_step2 * 0.98;

		if (this.config.printOutput) logger.debug(`CePO: Execution result (truncated: ${truncated}): ${solution.substring(0, 200)}...`);
		return { solution, truncated };
	}

	// Renamed from refinePlan to refineOutputs, as it refines solutions
	private async refineOutputs(
		executedSolutions: string[],
		questionOnlyContext: string, // The extracted question part for context
		opts: GenerateTextOptions | undefined,
	): Promise<string> {
		if (executedSolutions.length === 0) {
			logger.error('CePO: refineOutputs called with no solutions.');
			throw new Error('CePO: Cannot refine with no solutions.');
		}
		const combinedSolutionsText = executedSolutions.map((out, index) => `Response ${index + 1}:\n${out}`).join('\n\n');
		const refinePromptText = `Can you review your last ${executedSolutions.length} responses and identify any inconsistency between them. After that, can you address it and present a final step-by-step solution to the problem? Here is the question:\n${questionOnlyContext}`;

		// Python: messages = [{"role": "assistant", "content": plans_message}, {"role": "user", "content": content}]
		// No original system prompt from initialMessages here.
		const messagesForRefinement: LlmMessage[] = [assistant(combinedSolutionsText), user(refinePromptText)];

		try {
			const refined = await this.llm.generateText(messagesForRefinement, {
				...opts,
				temperature: this.config.planning_temperature_step3,
				maxOutputTokens: this.config.planning_max_tokens_step3,
			});
			if (this.config.printOutput) logger.debug(`CePO: Refined output: ${refined.substring(0, 200)}...`);
			return refined;
		} catch (error) {
			logger.error(`CePO: Error during output refinement: ${(error as Error).message}. Falling back to the first generated output.`);
			return executedSolutions[0]; // Python's fallback
		}
	}

	// Renamed from generateFinalAnswer
	private async generateFinalAnswerFromRefined(
		refinedOutput: string,
		originalTaskText: string, // The full original user query
		opts: GenerateTextOptions | undefined,
	): Promise<string> {
		const finalAnswerPromptText = `Use your final solution from above to correctly answer the question. Here is the question:\n${originalTaskText}`;

		// Python: messages = [{"role": "assistant", "content": final_solution}, {"role": "user", "content": content}]
		// No original system prompt from initialMessages here.
		const messagesForFinalAnswer: LlmMessage[] = [assistant(refinedOutput), user(finalAnswerPromptText)];

		const finalAnswer = await this.llm.generateText(messagesForFinalAnswer, {
			...opts,
			temperature: this.config.planning_temperature_step4,
			maxOutputTokens: this.config.planning_max_tokens_step4,
		});
		if (this.config.printOutput) logger.debug(`CePO: Final Answer generated: ${finalAnswer.substring(0, 200)}...`);
		return finalAnswer;
	}

	private async generateCompletion(initialMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions, approach?: string): Promise<string> {
		const executedSolutions: string[] = [];
		let attempts = 0;
		let lastAttemptedSolution: string | undefined; // For Python-like fallback

		const systemMessage = initialMessages.find((m) => m.role === 'system');
		const originalUserQueryText = lastText(initialMessages); // This is the 'task' or 'initial_query'
		const questionOnly = this.extractQuestionOnly(originalUserQueryText);

		while (executedSolutions.length < this.config.planning_n && attempts < this.config.planning_m) {
			attempts++;
			try {
				// Step 1: Plan Generation
				const planResult = await this.generatePlan(systemMessage, questionOnly, opts, approach);
				if (planResult.truncated) {
					if (this.config.printOutput) logger.warn(`CePO: Plan generation attempt ${attempts} rejected due to length/truncation.`);
					// lastAttemptedPlan = planResult.plan; // Save plan if needed for fallback, though Python saves solution
					continue; // Skip if plan is truncated
				}

				const messagesForPlan: LlmMessage[] = [];
				if (systemMessage) messagesForPlan.push(systemMessage);
				// Reconstruct user prompt for plan to pass to executePlan
				let planPromptTextForHistory: string;
				if (this.config.use_plan_diversity && approach) {
					planPromptTextForHistory = `To answer this question, can you come up with a concise plan using to solve it step-by-step but do not provide the final answer. Here is the approach you need to follow to generate the plan: ${approach}. Also, for each step, provide your confidence in the correctness of that step as well as your ability to execute it correctly. Here is the question:\n${questionOnly}\nRead the question again:\n\n${questionOnly}`;
				} else {
					planPromptTextForHistory = `To answer this question, can you come up with a concise plan to solve it step-by-step but do not provide the final answer. Also, for each step, provide your confidence in the correctness of that step as well as your ability to execute it correctly. Here is the question:\n${questionOnly}\nRead the question again:\n\n${questionOnly}`;
				}
				messagesForPlan.push(user(planPromptTextForHistory));

				// Step 2: Initial Solution (Execute the plan)
				const messagesAfterPlan = [...messagesForPlan, assistant(planResult.plan)];
				const solutionResult = await this.executePlan(messagesAfterPlan, opts);
				lastAttemptedSolution = solutionResult.solution; // Save last attempted solution

				if (solutionResult.truncated) {
					if (this.config.printOutput) logger.warn(`CePO: Plan execution attempt ${attempts} rejected due to length/truncation.`);
					continue; // Skip if solution is truncated
				}

				executedSolutions.push(solutionResult.solution);
				if (this.config.printOutput)
					logger.debug(
						`CePO: Plan proposal and execution successful. Attempt ${attempts}. Got ${executedSolutions.length}/${this.config.planning_n} solutions.`,
					);
			} catch (error) {
				logger.warn(`CePO: Plan generation/execution attempt ${attempts} failed: ${(error as Error).message}`);
			}
		}

		if (executedSolutions.length === 0) {
			if (lastAttemptedSolution) {
				logger.warn('CePO: No valid solutions generated from plans. Using the last attempted solution as a fallback.');
				executedSolutions.push(lastAttemptedSolution);
			} else {
				logger.error('CePO: Failed to generate any solution or plan fallback for this completion.');
				throw new Error('CePO: Failed to generate any candidate solution for this completion path.');
			}
		}

		const refinedOutput = await this.refineOutputs(executedSolutions, questionOnly, opts);
		return await this.generateFinalAnswerFromRefined(refinedOutput, originalUserQueryText, opts);
	}

	// In CePO_LLM class

	private async rateAnswers(answers: string[], initialMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		if (answers.length === 0) {
			logger.error('CePO: rateAnswers called with no answers to rate.');
			throw new Error('CePO: No answers to rate.');
		}
		if (answers.length === 1) return answers[0]; // Only one answer, no need to rate

		if (this.config.bestofn_rating_type === 'absolute') {
			return this.rateAnswersAbsolute(answers, initialMessages, opts);
		}
		if (this.config.bestofn_rating_type === 'pairwise') {
			return this.rateAnswersPairwise(answers, initialMessages, opts);
		}
		throw new Error(`Invalid rating type: ${this.config.bestofn_rating_type}`);
	}

	private async rateAnswersAbsolute(answers: string[], initialMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		const ratings: number[] = [];
		const originalSystemMessage = initialMessages.find((m) => m.role === 'system');
		// Use the last user message from initialMessages as the query being answered
		const originalUserQueryMessage = initialMessages.filter((m) => m.role === 'user').at(-1);

		if (!originalUserQueryMessage) {
			logger.error('CePO: Cannot perform absolute rating without original user query.');
			return answers[0]; // Fallback
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

		for (const answer of answers) {
			const messagesForRating: LlmMessage[] = [];
			messagesForRating.push({ role: 'system', content: effectiveSystemContent });
			messagesForRating.push(originalUserQueryMessage); // The question being answered
			messagesForRating.push(assistant(answer)); // The answer being rated
			messagesForRating.push(
				user(
					`Rate the above response beginning with the detailed explanation followed by a rating of 0 or 1 by strictly following this format: "Explanation: <reason for your rating>\\n\\nRating: [[rating]]".`,
				),
			);

			try {
				const ratingResponseText = await this.ratingLlm.generateText(messagesForRating, {
					...opts,
					temperature: this.config.bestofn_temperature,
					maxOutputTokens: this.config.bestofn_max_tokens,
				});
				if (this.config.printOutput) logger.debug(`CePO Absolute Rating: Response for answer "${answer.substring(0, 50)}...": ${ratingResponseText}`);

				const ratingMatch = ratingResponseText.match(/Rating: \[\[([01])\]\]/); // Python expects 0 or 1
				const rating = ratingMatch ? Number.parseInt(ratingMatch[1], 10) : -1; // Default to -1 on parsing error
				ratings.push(rating);
			} catch (error) {
				logger.error(`CePO Absolute Rating: Error rating answer: ${(error as Error).message}`);
				ratings.push(-1); // Error in rating
			}
		}

		if (this.config.printOutput) logger.debug(`CePO Absolute Ratings: ${ratings.join(', ')}`);

		let bestAnswerIndex = ratings.indexOf(Math.max(...ratings));
		// If all ratings are -1 (error or all incorrect), Math.max will be -1. indexOf(-1) will be the first occurrence.
		if (bestAnswerIndex === -1 || (ratings[bestAnswerIndex] === -1 && ratings.every((r) => r === -1))) {
			logger.warn('CePO Absolute Rating: All ratings were -1 or no valid ratings. Defaulting to the first answer.');
			bestAnswerIndex = 0;
		}
		return answers[bestAnswerIndex];
	}

	private generateAllDistinctPairs(n: number): [number, number][] {
		// Python: pairs = [(i, j) for i in range(N) for j in range(N) if i != j]
		const pairs: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < n; j++) {
				if (i !== j) {
					pairs.push([i, j]);
				}
			}
		}
		return pairs;
	}

	private async rateAnswersPairwise(answers: string[], initialMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		const numAnswers = answers.length;
		const ratings: number[] = new Array(numAnswers).fill(0);

		const originalSystemMessage = initialMessages.find((m) => m.role === 'system');
		const originalUserQueryMessage = initialMessages.filter((m) => m.role === 'user').at(-1);

		if (!originalUserQueryMessage) {
			logger.error('CePO: Cannot perform pairwise rating without original user query.');
			return answers[0]; // Fallback
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

		// Python appends this as a system message *after* assistant content.
		const pairwiseFormatReminder = `Reply with "Better Response: [[response id]]".
If the first response is better, reply with "Better Response: [[0]]".
If the second response is better, reply with "Better Response: [[1]]".`;

		const pairs = this.generateAllDistinctPairs(numAnswers);

		for (const [idx1, idx2] of pairs) {
			const responsesPairText = `Response 0: ${answers[idx1]}\n\nResponse 1: ${answers[idx2]}`;

			// Python: [orig_sys, orig_user, sys_pairwise_instr, assistant_pair, sys_pairwise_format_reminder]
			const messagesForPairRating: LlmMessage[] = [];
			if (originalSystemMessage) messagesForPairRating.push(originalSystemMessage);
			messagesForPairRating.push(originalUserQueryMessage);
			messagesForPairRating.push({ role: 'system', content: pairwiseSystemInstructions });
			messagesForPairRating.push(assistant(responsesPairText));
			messagesForPairRating.push({ role: 'system', content: pairwiseFormatReminder }); // Python puts this as system

			try {
				const ratingResponseText = await this.ratingLlm.generateText(messagesForPairRating, {
					...opts,
					temperature: this.config.bestofn_temperature,
					maxOutputTokens: this.config.bestofn_max_tokens,
				});
				if (this.config.printOutput) logger.debug(`CePO Pairwise Rating: Response for pair (${idx1}, ${idx2}): ${ratingResponseText}`);

				const match = ratingResponseText.match(/Better Response: \[\[([01])\]\]/);
				if (match) {
					const winnerInPair = Number.parseInt(match[1], 10); // 0 or 1
					ratings[winnerInPair === 0 ? idx1 : idx2]++;
				} else {
					ratings[idx1]++; // Python defaults to the first response in the pair if parsing fails
					logger.warn(`CePO Pairwise Rating: Parsing failed for pair (${idx1}, ${idx2}). Defaulting to first response in pair (idx ${idx1}).`);
				}
			} catch (error) {
				logger.error(`CePO Pairwise Rating: Error rating pair (${idx1}, ${idx2}): ${(error as Error).message}`);
				ratings[idx1]++; // Default to first on error
			}
		}

		if (this.config.printOutput) logger.debug(`CePO Pairwise Ratings: ${ratings.join(', ')}`);

		let bestAnswerIndex = ratings.indexOf(Math.max(...ratings));
		if (bestAnswerIndex === -1) bestAnswerIndex = 0; // Fallback if all ratings are 0 or issue
		return answers[bestAnswerIndex];
	}
	// Delete the old generatePairs method if it exists.
}
