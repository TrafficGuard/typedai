import { BaseLLM } from '#llm/base-llm';
import { GenerateTextOptions, LLM, LlmMessage, assistant, lastText, user } from '#llm/llm';
import { cerebrasLlama3_3_70b } from '#llm/services/cerebras';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';

interface CePOConfig {
	bestofn_n: number;
	bestofn_temperature: number;
	bestofn_max_tokens: number;
	bestofn_rating_type: 'absolute' | 'pairwise';
	planning_n: number;
	planning_m: number;
	planning_temperature_step1: number;
	planning_temperature_step2: number;
	planning_temperature_step3: number;
	planning_temperature_step4: number;
	planning_max_tokens_step1: number;
	planning_max_tokens_step2: number;
	planning_max_tokens_step3: number;
	planning_max_tokens_step4: number;
	printOutput: boolean;
}

const config: CePOConfig = {
	bestofn_n: 3,
	bestofn_temperature: 0.1,
	bestofn_max_tokens: 4096,
	bestofn_rating_type: 'absolute',
	planning_n: 3,
	planning_m: 6,
	planning_temperature_step1: 0.55,
	planning_temperature_step2: 0.25,
	planning_temperature_step3: 0.1,
	planning_temperature_step4: 0,
	planning_max_tokens_step1: 4096,
	planning_max_tokens_step2: 4096,
	planning_max_tokens_step3: 4096,
	planning_max_tokens_step4: 4096,
	printOutput: false,
};

//  https://github.com/codelion/optillm/blob/main/optillm/cepo/README.md

export function CePO_Cerebras_Llama70b(): LLM {
	return new CePO_LLM(() => cerebrasLlama3_3_70b(), 'CePO (Llama 3.3 70b Cerebras)');
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

	/**
	 * @param llmProvider
	 * @param name
	 */
	constructor(llmProvider?: () => LLM, name?: string) {
		super(
			name ?? `CePO ${llmProvider().getId()}`,
			'multi',
			`CePO-${llmProvider().getId()}`,
			128_000,
			() => 0,
			() => 0,
		);
		this.llm = llmProvider();
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

	protected async generateTextFromMessages(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		return withActiveSpan(`CePO id:${opts.id}`, async () => {
			const completions: string[] = [];
			for (let i = 0; i < config.bestofn_n; i++) {
				const completion = await this.generateCompletion(llmMessages, opts);
				completions.push(completion);
			}

			const bestAnswer = await this.rateAnswers(completions, llmMessages, opts);

			return bestAnswer;
		});
	}

	private async generatePlan(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const userMessageContent = lastText(llmMessages);
		// TODO replace the last message with the planning prompt
		const planPrompt = `To answer this question, can you come up with a concise plan to solve it step-by-step but do not provide the final answer. Also, for each step, provide your confidence in the correctness of that step as well as your ability to execute it correctly. Here is the question:\n${userMessageContent}`;
		const messages: LlmMessage[] = [...llmMessages, user(planPrompt)];

		try {
			const plan = await this.llm.generateText(messages, {
				...opts,
				temperature: config.planning_temperature_step1,
			});
			if (config.printOutput) {
				logger.debug(`Generated plan: ${plan}`);
			}
			return plan;
		} catch (error) {
			logger.error(`Error during plan generation: ${error}`);
			throw error;
		}
	}

	private async executePlan(plan: string, llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const executePrompt =
			'Can you execute the above plan step-by-step to produce the final answer. Be extra careful when executing steps where your confidence is lower.';
		const messages: LlmMessage[] = [...llmMessages, assistant(plan), user(executePrompt)];

		try {
			const solution = await this.llm.generateText(messages, {
				...opts,
				temperature: config.planning_temperature_step2,
			});
			if (config.printOutput) {
				logger.debug(`Execution result: ${solution}`);
			}
			return solution;
		} catch (error) {
			logger.error(`Error during plan execution: ${error}`);
			throw error;
		}
	}

	private async refinePlan(plans: string[], llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const userMessageContent = lastText(llmMessages);
		const combinedPlans = plans.map((plan, index) => `Plan ${index + 1}:\n${plan}`).join('\n\n');

		const refinePrompt = `Can you review the following plans and identify any inconsistencies between them. After that, can you address them and present a final step-by-step solution to the problem? Here is the question:\n${userMessageContent}`;

		const messages: LlmMessage[] = [...llmMessages];
		messages.push(assistant(combinedPlans));
		messages.push(user(refinePrompt));

		try {
			const refinedPlan = await this.llm.generateText(messages, {
				...opts,
				temperature: config.planning_temperature_step3,
				// maxTokens: config.planning_max_tokens_step3,
			});
			logger.debug(`Refined plan: ${refinedPlan}`);
			return refinedPlan;
		} catch (error) {
			logger.error(`Error during plan refinement: ${error}`);
			throw error;
		}
	}

	private async generateFinalAnswer(refinedPlan: string, llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const userMessageContent = lastText(llmMessages);
		const finalAnswerPrompt = `Use your final solution from above to correctly answer the question. Here is the question:\n${userMessageContent}`;

		const messages: LlmMessage[] = [...llmMessages];
		messages.push(assistant(refinedPlan));
		messages.push(user(finalAnswerPrompt));

		return await this.llm.generateText(messages, { ...opts, temperature: 0 });
	}

	private async rateAnswers(answers: string[], llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		if (config.bestofn_rating_type === 'absolute') {
			return this.rateAnswersAbsolute(answers, llmMessages, opts);
		}
		if (config.bestofn_rating_type === 'pairwise') {
			return this.rateAnswersPairwise(answers, llmMessages, opts);
		}
		throw new Error(`Invalid rating type: ${config.bestofn_rating_type}`);
	}

	private extractQuestionOnly(task: string): string {
		let questionOnly = task.replace('\n## Question: \n\n', '');
		questionOnly = questionOnly.replace(/\n\n\n## Instruction[\s\S]*```json\n{\n {4}"reasoning": "___",\n {4}"answer": "___"\n}\n```/g, '');
		return questionOnly.trim();
	}

	private async generateCompletion(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const plans: string[] = [];
		let attempts = 0;

		// Step 1 and 2: Generate Plans and Execute Plans with retries
		while (plans.length < config.planning_n && attempts < config.planning_m) {
			attempts++;
			try {
				const plan = await this.generatePlan(llmMessages, opts);
				const solution = await this.executePlan(plan, llmMessages, opts);
				plans.push(solution);
			} catch (error) {
				logger.error(`Plan generation attempt ${attempts} failed: ${error}`);
			}
		}

		// If no valid plans, proceed with the last attempted plan
		if (plans.length === 0) {
			logger.warn('No valid plans generated. Proceeding with the last attempted plan.');
			// Attempt to generate one last plan
			try {
				const lastPlan = await this.generatePlan(llmMessages, opts);
				const lastSolution = await this.executePlan(lastPlan, llmMessages, opts);
				plans.push(lastSolution);
			} catch (error) {
				logger.error('Failed to generate a fallback plan.');
				// Re-throw the error if unable to proceed
				throw new Error('Failed to generate any valid plans.');
			}
		}

		// Step 3: Refine Plan
		const refinedPlan = await this.refinePlan(plans, llmMessages, opts);

		// Step 4: Generate Final Answer
		return await this.generateFinalAnswer(refinedPlan, llmMessages, opts);
	}

	private async rateAnswersAbsolute(answers: string[], llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const ratings: number[] = [];
		const userMessageContent = lastText(llmMessages);

		const ratingPrompt = `Please act as an impartial judge and evaluate the quality of the response provided by an AI assistant to the user question displayed below. Your evaluation should consider correctness as a primary factor as well as other factors such as helpfulness, relevance, accuracy, depth, creativity, and level of detail of the response.

Evaluation Criteria:
- Correctness: How free is it from errors or mistakes?
- Helpfulness: How effectively does the response meet the user's needs?
- Relevance: How directly does the response address the original question?
- Accuracy: Are the information and explanations factually correct?
- Depth: Does the response provide comprehensive and meaningful insights?
- Creativity: Does the response offer unique or innovative perspectives?
- Clarity: Is the response well-organized, coherent, and easy to understand?

Begin your evaluation by providing a short explanation. Be as objective as possible. After providing your explanation, please rate the response on a scale of 1 to 10 by strictly following this format: "Rating: [[rating]]", for example: "Rating: [[5]]"`;

		for (const answer of answers) {
			const messages: LlmMessage[] = [...llmMessages];
			messages.push(assistant(answer));
			messages.push(user(ratingPrompt));

			const ratingResponse = await this.llm.generateText(messages, {
				...opts,
				temperature: config.bestofn_temperature,
				//maxTokens: config.bestofn_max_tokens,
			});
			const ratingMatch = ratingResponse.match(/Rating: \[\[(\d+)\]\]/);
			const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : 0;
			ratings.push(rating);
		}

		// Select the answer with the highest rating
		const bestAnswerIndex = ratings.indexOf(Math.max(...ratings));
		return answers[bestAnswerIndex];
	}

	private async rateAnswersPairwise(answers: string[], llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const ratings: number[] = new Array(answers.length).fill(0);
		const pairs = this.generatePairs(answers.length);

		const ratingPrompt = `Please act as an impartial judge and compare the quality of the two responses provided by the AI assistant to the user's question displayed below. Evaluation Criteria:
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

		for (const [i, j] of pairs) {
			const responsesPair = `Response 0: ${answers[i]}\n\nResponse 1: ${answers[j]}`;
			const messages: LlmMessage[] = [...llmMessages];
			messages.push(assistant(responsesPair));
			messages.push(user(ratingPrompt));

			const ratingResponse = await this.llm.generateText(messages, {
				...opts,
				temperature: config.bestofn_temperature,
				//maxTokens: config.bestofn_max_tokens,
			});

			const match = ratingResponse.match(/Better Response: \[\[(\d+)\]\]/);
			if (match) {
				const winner = parseInt(match[1], 10);
				ratings[winner === 0 ? i : j]++;
			}
		}

		const bestAnswerIndex = ratings.indexOf(Math.max(...ratings));
		return answers[bestAnswerIndex];
	}

	private generatePairs(n: number): [number, number][] {
		const pairs: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				pairs.push([i, j]);
			}
		}
		return pairs;
	}
}
