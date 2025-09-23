import axios from 'axios';
import { agentContext } from '#agent/agentContextLocalStorage';
import { appContext } from '#app/applicationContext';
import { callStack } from '#llm/llmCallService/llmCall';
import { countTokens } from '#llm/tokens';
import { withActiveSpan } from '#o11y/trace';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { type GenerateTextOptions, type LLM, type LlmMessage } from '#shared/llm/llm.model';
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

	override isConfigured(): boolean {
		return Boolean(process.env.OLLAMA_API_URL);
	}

	private getOllamaApiUrl(): string | undefined {
		return process.env.OLLAMA_API_URL;
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	override async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		return withActiveSpan(`generateMessage ${opts?.id ?? ''}`, async (span) => {
			const inputPromptString = messages.map((m) => m.content).join('\n');

			span.setAttributes({
				input: inputPromptString,
				inputChars: inputPromptString.length,
				model: this.model,
				service: this.service,
			});

			const llmCallSave: Promise<LlmCall> = appContext().llmCallService.saveRequest({
				messages: [...messages],
				llmId: this.getId(),
				agentId: agentContext()?.agentId,
				callStack: callStack(),
				settings: opts ?? {},
			});
			const requestTime = Date.now();

			const url = `${this.getOllamaApiUrl()}/api/chat`;

			const response = await axios.post(url, {
				model: this.model,
				messages: messages,
				stream: false,
				options: {
					temperature: opts?.temperature ?? 1,
					top_p: opts?.topP,
				},
			});

			const responseMessage: LlmMessage = response.data.message;
			const responseText = responseMessage.content as string;

			const timeToFirstToken = Date.now() - requestTime;
			const finishTime = Date.now();

			const llmCall: LlmCall = await llmCallSave;
			const inputTokens = await countTokens(inputPromptString);
			const outputTokens = await countTokens(responseText);
			const { totalCost } = this.calculateCosts(inputTokens, outputTokens, 0); // Will be 0
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

			return responseMessage;
		});
	}
}

// https://ollama.com/library/qwen3

export function Ollama_Qwen2_7b(): LLM {
	return new OllamaLLM('Qwen2 7B', 'qwen2:7b', 8192);
}

export function Ollama_Llama3_7b(): LLM {
	return new OllamaLLM('Llama3 7B', 'llama3:7b', 4096);
}

export function Ollama_CodeGemma_7b(): LLM {
	return new OllamaLLM('CodeGemma 7B', 'codegemma:7b', 8192);
}

export function Ollama_Phi3(): LLM {
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
