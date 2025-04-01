import { addCost, agentContext } from '#agent/agentContextLocalStorage';
import { AgentLLMs } from '#agent/agentContextTypes';
import { LlmCall } from '#llm/llmCallService/llmCall';
import { Blueberry } from '#llm/multi-agent/blueberry';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { appContext } from '../../applicationContext';
import { BaseLLM } from '../base-llm';
import { GenerateTextOptions, LLM, combinePrompts } from '../llm';

export class MockLLM extends BaseLLM {
	lastPrompt = '';
	private responses: { response: string; callback?: (prompt: string) => void }[] = [];
	/**
	 * @param maxInputTokens defaults to 100000
	 */
	constructor(maxInputTokens = 100000) {
		super(
			'mock',
			'mock',
			'mock',
			maxInputTokens,
			(input: string) => 0,
			(output: string) => 0,
		);
	}

	reset() {
		this.responses.length = 0;
	}

	setResponse(response: string, callback?: (prompt: string) => void) {
		this.responses = [{ response, callback }];
	}

	setResponses(responses: { response: string; callback?: (prompt: string) => void }[]) {
		this.responses = responses;
	}

	addResponse(response: string, callback?: (prompt: string) => void) {
		this.responses.push({ response, callback });
	}

	getLastPrompt(): string {
		if (!this.lastPrompt) throw new Error('No calls yet');
		return this.lastPrompt;
	}

	// @logTextGeneration
	async _generateText(systemPrompt: string | undefined, userPrompt: string, opts?: GenerateTextOptions): Promise<string> {
		logger.info(`MockLLM ${opts?.id ?? '<no id>'} ${userPrompt.substring(0, 50)}`);

		// if (!opts?.id) logger.info(new Error(`No id set for prompt ${userPrompt}`));

		return withActiveSpan('generateText', async (span) => {
			const prompt = combinePrompts(userPrompt, systemPrompt);
			this.lastPrompt = prompt;
			if (systemPrompt) span.setAttribute('systemPrompt', systemPrompt);
			span.setAttributes({
				userPrompt,
				inputChars: prompt.length,
				model: this.model,
				service: this.service,
			});

			if (this.responses.length === 0)
				throw new Error(`Need to call setResponses on MockLLM before calling generateText for prompt id:${opts?.id ?? '<no id>'} prompt:${userPrompt}`);

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				userPrompt,
				systemPrompt,
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				callStack: this.callStack(agentContext()),
			});
			const requestTime = Date.now();

			// remove the first item from this.responses
			const { response: responseText, callback } = this.responses.shift()!;
			// logger.info(`this.responses.length ${this.responses.length}`);
			// Call the callback function if it exists
			if (callback) {
				callback(userPrompt);
			}

			const timeToFirstToken = 1;
			const finishTime = Date.now();
			const llmCall: LlmCall = await llmCallSave;

			const inputCost = this.calculateInputCost(prompt, await this.countTokens(prompt));
			const outputCost = this.calculateOutputCost(responseText, await this.countTokens(responseText));
			const cost = inputCost + outputCost;
			addCost(cost);

			llmCall.responseText = responseText;
			llmCall.timeToFirstToken = timeToFirstToken;
			llmCall.totalTime = finishTime - requestTime;
			llmCall.cost = cost;

			try {
				await appContext().llmCallService.saveResponse(llmCall);
			} catch (e) {
				// queue to save
				console.error(e);
			}

			this.lastPrompt = userPrompt;

			span.setAttributes({
				response: responseText,
				timeToFirstToken,
				inputCost,
				outputCost,
				cost,
				outputChars: responseText.length,
			});

			logger.debug(`MockLLM response ${responseText}`);
			return responseText;
		});
	}
}

export const mockLLM = new MockLLM();

export function mockLLMRegistry(): Record<string, () => LLM> {
	return {
		// Tests need the same instance returned
		'mock:mock': () => mockLLM,
	};
}

export function mockLLMs(): AgentLLMs {
	return {
		easy: mockLLM,
		medium: mockLLM,
		hard: mockLLM,
		xhard: mockLLM,
	};
}
