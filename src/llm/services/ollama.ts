import axios from 'axios';
import { agentContext } from '#agent/agentContextLocalStorage';
import { appContext } from '#app/applicationContext';
import { callStack } from '#llm/llmCallService/llmCall';
import { countTokens } from '#llm/tokens';
import { withActiveSpan } from '#o11y/trace';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { type GenerateTextOptions, type LLM, type LlmMessage, assistant, combinePrompts, system, user } from '#shared/llm/llm.model';
import type { LlmCall } from '#shared/llmCall/llmCall.model';
import { BaseLLM } from '../base-llm';

export const OLLAMA_SERVICE = 'ollama';

export class OllamaLLM extends BaseLLM {
	constructor(name: string, model: string, maxInputTokens: number) {
		super(`${name} (Ollama)`, OLLAMA_SERVICE, model, maxInputTokens, () => ({
			inputCost: 0,
			outputCost: 0,
			totalCost: 0,
		}));
	}

	isConfigured(): boolean {
		return Boolean(process.env.OLLAMA_API_URL);
	}

	private getOllamaApiUrl(): string {
		return process.env.OLLAMA_API_URL;
	}

	async _generateText(systemPrompt: string | undefined, userPrompt: string, opts?: GenerateTextOptions): Promise<string> {
		return withActiveSpan(`generateText ${opts?.id ?? ''}`, async (span) => {
			const messages: LlmMessage[] = [];
			if (systemPrompt) messages.push(system(systemPrompt));
			messages.push(user(userPrompt));

			const prompt = combinePrompts(userPrompt, systemPrompt);

			span.setAttributes({
				userPrompt,
				inputChars: prompt.length,
				model: this.model,
				service: this.service,
			});

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				messages,
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				callStack: callStack(),
				settings: opts,
			});
			const requestTime = Date.now();

			const url = `${this.getOllamaApiUrl()}/api/generate`;

			const response = await axios.post(url, {
				model: this.model,
				prompt: prompt,
				stream: false,
				options: {
					temperature: opts?.temperature ?? 1,
					top_p: opts?.topP,
				},
			});

			const responseText = response.data.response;
			messages.push(assistant(responseText));

			const timeToFirstToken = Date.now() - requestTime;
			const finishTime = Date.now();

			const llmCall: LlmCall = await llmCallSave;
			const inputTokens = await countTokens(prompt);
			const outputTokens = await countTokens(responseText);
			const { totalCost } = this.calculateCosts(inputTokens, outputTokens); // Will be 0
			llmCall.timeToFirstToken = timeToFirstToken;
			llmCall.totalTime = finishTime - requestTime;
			llmCall.cost = totalCost; // VM cost?
			llmCall.inputTokens = inputTokens;
			llmCall.outputTokens = outputTokens;

			try {
				await appContext().llmCallService.saveResponse(llmCall);
			} catch (e) {
				// queue to save
				console.error(e);
			}

			span.setAttributes({
				response: responseText,
				timeToFirstToken,
				outputChars: responseText.length,
			});

			return responseText;
		});
	}
}

// https://ollama.com/library/qwen3

export function Ollama_Qwen2_7b() {
	return new OllamaLLM('Qwen2 7B', 'qwen2:7b', 8192);
}

export function Ollama_Llama3_7b() {
	return new OllamaLLM('Llama3 7B', 'llama3:7b', 4096);
}

export function Ollama_CodeGemma_7b() {
	return new OllamaLLM('CodeGemma 7B', 'codegemma:7b', 8192);
}

export function Ollama_Phi3() {
	return new OllamaLLM('Phi3', 'phi3:latest', 2048);
}

export function Ollama_LLMs(): AgentLLMs {
	return {
		easy: Ollama_Phi3(),
		medium: Ollama_Phi3(),
		hard: Ollama_Llama3_7b(),
		xhard: Ollama_Llama3_7b(),
	};
}

export function ollamaLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${OLLAMA_SERVICE}:qwen2:7b`]: Ollama_Qwen2_7b,
		[`${OLLAMA_SERVICE}:llama3:7b`]: Ollama_Llama3_7b,
		[`${OLLAMA_SERVICE}:codegemma:7b`]: Ollama_CodeGemma_7b,
		[`${OLLAMA_SERVICE}:phi3:latest`]: Ollama_Phi3,
	};
}
