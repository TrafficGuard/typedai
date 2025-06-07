import { cerebrasQwen3_32b } from '#llm/services/cerebras';
import { Gemini_2_5_Pro } from '#llm/services/gemini';
import { vertexGemini_2_5_Flash, vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { type GenerateTextOptions, type LLM, type LlmMessage, messageContentIfTextOnly, messageText } from '#shared/llm/llm.model';
import { BaseLLM } from '../base-llm';

/**
 * LLM implementation for medium level LLM using a fast provider if available and applicable, else falling back to the standard medium LLM
 * https://artificialanalysis.ai/?models_selected=o1-mini%2Cgpt-4o%2Cgpt-4o-mini%2Cllama-3-1-instruct-405b%2Cllama-3-1-instruct-70b%2Cgemini-1-5-pro%2Cgemini-1-5-flash%2Cclaude-35-sonnet%2Cclaude-3-5-haiku%2Cdeepseek-v2-5%2Cqwen2-5-72b-instruct%2Cqwen2-5-coder-32b-instruct&models=gemini-2-5-flash%2Cgemini-2-5-flash-reasoning%2Ccerebras_qwen3-32b-instruct-reasoning%2Csambanova_llama-4-maverick%2Csambanova_deepseek-v3-0324%2Csambanova_qwen3-32b-instruct-reasoning&endpoints=cerebras_qwen3-32b-instruct-reasoning%2Csambanova_llama-4-maverick%2Csambanova_deepseek-v3-0324%2Csambanova_qwen3-32b-instruct-reasoning
 */
export class Gemini25Pro extends BaseLLM {
	private readonly vertex = vertexGemini_2_5_Pro();
	private readonly gemini = Gemini_2_5_Pro();

	constructor() {
		super('GeminiPro2.5', 'vertex', 'gemini-2.5-pro-preview-05-06', 0, () => ({
			inputCost: 0,
			outputCost: 0,
			totalCost: 0,
		}));
		this.maxInputTokens = this.vertex.getMaxInputTokens();
	}

	isConfigured(): boolean {
		return this.gemini.isConfigured() || this.vertex.isConfigured();
	}

	protected supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected async generateTextFromMessages(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const message = await this._generateMessage(llmMessages, opts);
		return messageText(message);
	}

	async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		try {
			return await this.gemini.generateMessage(messages, opts);
		} catch (e) {
			logger.warn(e, `Error calling ${this.gemini.getId()}`);
		}
		return await this.vertex.generateMessage(messages, opts);
	}
}
