import { spawn } from 'node:child_process';
import { agentContext } from '#agent/agentContext';
import { appContext } from '#app/applicationContext';
import { callStack } from '#llm/llmCallService/llmCall';
import { countTokens } from '#llm/tokens';
import { withActiveSpan } from '#o11y/trace';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { type GenerateTextOptions, type LLM, type LlmMessage } from '#shared/llm/llm.model';
import type { LlmCall } from '#shared/llmCall/llmCall.model';
import { BaseLLM } from '../base-llm';

export const MLX_SERVICE = 'mlx';

/**
 * Configuration for MLX LLM models
 */
export interface MlxModelConfig {
	/** Display name for the model */
	displayName: string;
	/** HuggingFace model ID (e.g., 'mlx-community/gemma-3-4b-it-4bit') */
	model: string;
	/** Maximum input tokens */
	maxInputTokens: number;
	/** Maximum output tokens (default: 4096) */
	maxOutputTokens?: number;
	/** Default temperature (default: 0.7) */
	defaultTemperature?: number;
	/** Default top_p (default: 0.9) */
	defaultTopP?: number;
}

/**
 * Pre-configured MLX models available from mlx-community
 */
export const MLX_MODELS = {
	// Gemma models
	GEMMA_3_4B_IT: {
		displayName: 'Gemma 3 4B Instruct',
		model: 'mlx-community/gemma-3-4b-it-4bit',
		maxInputTokens: 8192,
	},
	GEMMA_3_12B_IT: {
		displayName: 'Gemma 3 12B Instruct',
		model: 'mlx-community/gemma-3-12b-it-4bit',
		maxInputTokens: 8192,
	},
	GEMMA_3_27B_IT: {
		displayName: 'Gemma 3 27B Instruct',
		model: 'mlx-community/gemma-3-27b-it-4bit',
		maxInputTokens: 8192,
	},

	// Qwen models
	QWEN_3_8B: {
		displayName: 'Qwen 3 8B',
		model: 'mlx-community/Qwen3-8B-4bit',
		maxInputTokens: 32768,
	},
	QWEN_3_14B: {
		displayName: 'Qwen 3 14B',
		model: 'mlx-community/Qwen3-14B-4bit',
		maxInputTokens: 32768,
	},
	QWEN_3_32B: {
		displayName: 'Qwen 3 32B',
		model: 'mlx-community/Qwen3-32B-4bit',
		maxInputTokens: 32768,
	},

	// Llama models
	LLAMA_3_8B_IT: {
		displayName: 'Llama 3 8B Instruct',
		model: 'mlx-community/Meta-Llama-3-8B-Instruct-4bit',
		maxInputTokens: 8192,
	},
	LLAMA_3_1_8B_IT: {
		displayName: 'Llama 3.1 8B Instruct',
		model: 'mlx-community/Meta-Llama-3.1-8B-Instruct-4bit',
		maxInputTokens: 131072,
	},

	// Mistral models
	MISTRAL_7B_IT: {
		displayName: 'Mistral 7B Instruct',
		model: 'mlx-community/Mistral-7B-Instruct-v0.3-4bit',
		maxInputTokens: 32768,
	},
	MISTRAL_3_14B_6bit: {
		displayName: 'Mistral 3 14B 6bit',
		model: 'mlx-community/Ministral-3-14B-Reasoning-2512-6bit',
		maxInputTokens: 32768,
	},

	// DeepSeek models
	DEEPSEEK_R1_7B: {
		displayName: 'DeepSeek R1 Distill Qwen 7B',
		model: 'mlx-community/DeepSeek-R1-Distill-Qwen-7B-4bit',
		maxInputTokens: 32768,
	},
	DEEPSEEK_R1_14B: {
		displayName: 'DeepSeek R1 Distill Qwen 14B',
		model: 'mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit',
		maxInputTokens: 32768,
	},
	DEEPSEEK_R1_32B: {
		displayName: 'DeepSeek R1 Distill Qwen 32B',
		model: 'mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit',
		maxInputTokens: 32768,
	},

	// GPT-OSS (Cerebras)
	GPT_OSS_20B: {
		displayName: 'GPT-OSS 20B',
		model: 'mlx-community/gpt-oss-20b-MXFP4-Q4',
		maxInputTokens: 8192,
	},

	// Phi models
	PHI_4_14B: {
		displayName: 'Phi 4 14B',
		model: 'mlx-community/phi-4-4bit',
		maxInputTokens: 16384,
	},
} as const;

/**
 * MLX LLM provider for Apple Silicon Macs
 * Uses mlx_lm.generate CLI for local inference
 *
 * Prerequisites:
 * - Apple Silicon Mac (M1/M2/M3/M4)
 * - Python environment with mlx-lm installed: pip install mlx-lm
 * - Set MLX_ENABLED=true environment variable
 */
export class MlxLLM extends BaseLLM {
	private defaultTemperature: number;
	private defaultTopP: number;

	constructor(config: MlxModelConfig) {
		super({
			displayName: `${config.displayName} (MLX)`,
			service: MLX_SERVICE,
			modelId: config.model,
			maxInputTokens: config.maxInputTokens,
			maxOutputTokens: config.maxOutputTokens ?? 4096,
			calculateCosts: () => ({
				inputCost: 0,
				outputCost: 0,
				totalCost: 0,
			}),
		});
		this.defaultTemperature = config.defaultTemperature ?? 0.7;
		this.defaultTopP = config.defaultTopP ?? 0.9;
	}

	override isConfigured(): boolean {
		// Check if MLX is enabled via environment variable
		return process.env.MLX_ENABLED === 'true';
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	/**
	 * Convert LlmMessages to a single prompt string with chat template markers
	 */
	private messagesToPrompt(messages: ReadonlyArray<LlmMessage>): { systemPrompt?: string; userPrompt: string } {
		let systemPrompt: string | undefined;
		const userParts: string[] = [];

		for (const msg of messages) {
			const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

			if (msg.role === 'system') {
				systemPrompt = content;
			} else if (msg.role === 'user') {
				userParts.push(content);
			} else if (msg.role === 'assistant') {
				// Include assistant messages as context
				userParts.push(`Assistant: ${content}`);
			}
		}

		return {
			systemPrompt,
			userPrompt: userParts.join('\n\n'),
		};
	}

	/**
	 * Execute mlx_lm.generate command and return the output
	 */
	private async runMlxGenerate(
		prompt: string,
		systemPrompt?: string,
		opts?: GenerateTextOptions,
	): Promise<{ output: string; promptTokens: number; generationTokens: number; tokensPerSec: number }> {
		return new Promise((resolve, reject) => {
			const args: string[] = [
				'--model',
				this.getServiceModelId(),
				'--prompt',
				prompt,
				'--max-tokens',
				String(opts?.maxOutputTokens ?? this.maxOutputTokens ?? 4096),
				'--temp',
				String(opts?.temperature ?? this.defaultTemperature),
				'--top-p',
				String(opts?.topP ?? this.defaultTopP),
			];

			// Add system prompt if provided
			if (systemPrompt) {
				args.push('--system-prompt', systemPrompt);
			}

			const mlxProcess = spawn('mlx_lm.generate', args, {
				stdio: ['pipe', 'pipe', 'pipe'],
				env: { ...process.env },
			});

			let stdout = '';
			let stderr = '';

			mlxProcess.stdout.on('data', (data) => {
				stdout += data.toString();
			});

			mlxProcess.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			mlxProcess.on('close', (code) => {
				if (code !== 0) {
					reject(new Error(`mlx_lm.generate failed with code ${code}: ${stderr}`));
					return;
				}

				// Parse the output - MLX outputs the response between ========== markers
				const outputMatch = stdout.match(/==========\n([\s\S]*?)\n==========\n/);
				let output = outputMatch ? outputMatch[1] : stdout;

				// Clean up the output - remove any trailing stats
				output = output.trim();

				// Parse stats from stderr or stdout
				let promptTokens = 0;
				let generationTokens = 0;
				let tokensPerSec = 0;

				const promptMatch = stdout.match(/Prompt:\s*(\d+)\s*tokens/);
				const genMatch = stdout.match(/Generation:\s*(\d+)\s*tokens,\s*([\d.]+)\s*tokens-per-sec/);

				if (promptMatch) {
					promptTokens = Number.parseInt(promptMatch[1], 10);
				}
				if (genMatch) {
					generationTokens = Number.parseInt(genMatch[1], 10);
					tokensPerSec = Number.parseFloat(genMatch[2]);
				}

				resolve({
					output,
					promptTokens,
					generationTokens,
					tokensPerSec,
				});
			});

			mlxProcess.on('error', (error) => {
				reject(new Error(`Failed to spawn mlx_lm.generate: ${error.message}. Make sure mlx-lm is installed: pip install mlx-lm`));
			});
		});
	}

	override async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		return withActiveSpan(`generateMessage ${opts?.id ?? ''}`, async (span) => {
			const { systemPrompt, userPrompt } = this.messagesToPrompt(messages);
			const inputPromptString = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

			span.setAttributes({
				input: inputPromptString,
				inputChars: inputPromptString.length,
				model: this.getServiceModelId(),
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

			const result = await this.runMlxGenerate(userPrompt, systemPrompt, opts);

			const responseText = result.output;
			const timeToFirstToken = Date.now() - requestTime;
			const finishTime = Date.now();

			const llmCall: LlmCall = await llmCallSave;
			const inputTokens = result.promptTokens || (await countTokens(inputPromptString));
			const outputTokens = result.generationTokens || (await countTokens(responseText));
			const { totalCost } = this.calculateCosts(inputTokens, outputTokens, 0);

			llmCall.timeToFirstToken = timeToFirstToken;
			llmCall.totalTime = finishTime - requestTime;
			llmCall.cost = totalCost;
			llmCall.inputTokens = inputTokens;
			llmCall.outputTokens = outputTokens;

			try {
				await appContext().llmCallService.saveResponse(llmCall);
			} catch (e) {
				console.error(e);
			}

			span.setAttributes({
				response: responseText,
				timeToFirstToken,
				outputChars: responseText.length,
				tokensPerSec: result.tokensPerSec,
			});

			return {
				role: 'assistant',
				content: responseText,
			};
		});
	}
}

// ============================================
// Pre-configured model factory functions
// ============================================

// Gemma models
export function mlxGemma3_4b(): LLM {
	return new MlxLLM(MLX_MODELS.GEMMA_3_4B_IT);
}

export function mlxGemma3_12b(): LLM {
	return new MlxLLM(MLX_MODELS.GEMMA_3_12B_IT);
}

export function mlxGemma3_27b(): LLM {
	return new MlxLLM(MLX_MODELS.GEMMA_3_27B_IT);
}

// Qwen models
export function mlxQwen3_8b(): LLM {
	return new MlxLLM(MLX_MODELS.QWEN_3_8B);
}

export function mlxQwen3_14b(): LLM {
	return new MlxLLM(MLX_MODELS.QWEN_3_14B);
}

export function mlxQwen3_32b(): LLM {
	return new MlxLLM(MLX_MODELS.QWEN_3_32B);
}

// Llama models
export function mlxLlama3_8b(): LLM {
	return new MlxLLM(MLX_MODELS.LLAMA_3_8B_IT);
}

export function mlxLlama3_1_8b(): LLM {
	return new MlxLLM(MLX_MODELS.LLAMA_3_1_8B_IT);
}

// Mistral models
export function mlxMistral7b(): LLM {
	return new MlxLLM(MLX_MODELS.MISTRAL_7B_IT);
}

// DeepSeek R1 models
export function mlxDeepSeekR1_7b(): LLM {
	return new MlxLLM(MLX_MODELS.DEEPSEEK_R1_7B);
}

export function mlxDeepSeekR1_14b(): LLM {
	return new MlxLLM(MLX_MODELS.DEEPSEEK_R1_14B);
}

export function mlxDeepSeekR1_32b(): LLM {
	return new MlxLLM(MLX_MODELS.DEEPSEEK_R1_32B);
}

// GPT-OSS
export function mlxGptOss20b(): LLM {
	return new MlxLLM(MLX_MODELS.GPT_OSS_20B);
}

// Phi models
export function mlxPhi4_14b(): LLM {
	return new MlxLLM(MLX_MODELS.PHI_4_14B);
}

/**
 * Create a custom MLX LLM with any HuggingFace model
 */
export function mlxCustom(config: MlxModelConfig): LLM {
	return new MlxLLM(config);
}

/**
 * Default MLX LLM configuration for agents
 */
export function MLX_LLMs(): AgentLLMs {
	return {
		easy: mlxGemma3_4b(),
		medium: mlxQwen3_8b(),
		hard: mlxQwen3_14b(),
		xhard: mlxDeepSeekR1_32b(),
	};
}

/**
 * Registry of all MLX LLM factory functions
 */
export function mlxLLMRegistry(): Array<() => LLM> {
	return [
		mlxGemma3_4b,
		mlxGemma3_12b,
		mlxGemma3_27b,
		mlxQwen3_8b,
		mlxQwen3_14b,
		mlxQwen3_32b,
		mlxLlama3_8b,
		mlxLlama3_1_8b,
		mlxMistral7b,
		mlxDeepSeekR1_7b,
		mlxDeepSeekR1_14b,
		mlxDeepSeekR1_32b,
		mlxGptOss20b,
		mlxPhi4_14b,
	];
}
