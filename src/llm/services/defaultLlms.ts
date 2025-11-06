import { FastEasyLLM } from '#llm/multi-agent/fastEasy';
import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { MAD_Anthropic, MAD_Balanced, MAD_Fast, MAD_Grok, MAD_OpenAI, MAD_Vertex } from '#llm/multi-agent/reasoning-debate';
// import { MAD_Balanced, MAD_Vertex, MAD_Anthropic, MAD_OpenAI, MAD_Grok, MAD_Fast } from '#llm/multi-agent/reasoning-debate';
import { anthropicClaude4_5_Haiku, anthropicClaude4_5_Sonnet } from '#llm/services/anthropic';
import { vertexGemini_2_5_Flash, vertexGemini_2_5_Flash_Lite, vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { LLM } from '#shared/llm/llm.model';
import { Claude4_5_Sonnet_Vertex } from './anthropic-vertex';
import { cerebrasGptOss_120b, cerebrasQwen3_235b_Thinking, cerebrasZaiGLM_4_6 } from './cerebras';
import { fireworksGLM_4_6 } from './fireworks';
import { Gemini_2_5_Flash, Gemini_2_5_Flash_Lite, Gemini_2_5_Pro } from './gemini';
import { groqLlama4_Scout } from './groq';
import { Ollama_LLMs } from './ollama';
import { openaiGPT5, openaiGPT5mini, openaiGPT5nano } from './openai';
import { xai_Grok4 } from './xai';

let _summaryLLM: LLM;
let _defaultLLMs: AgentLLMs;

export function summaryLLM(): LLM {
	_summaryLLM ??= defaultLLMs().easy;
	return _summaryLLM;
}

export function defaultLLMs(): AgentLLMs {
	if (_defaultLLMs) return _defaultLLMs;

	// if (process.env.OLLAMA_API_URL) {
	// 	logger.info('Using Ollama LLMs')
	// 	_defaultLLMs = Ollama_LLMs();
	// 	return _defaultLLMs;
	// }

	const easyLLMs = [
		new FastEasyLLM(),
		vertexGemini_2_5_Flash_Lite(),
		Gemini_2_5_Flash_Lite(),
		cerebrasGptOss_120b(),
		groqLlama4_Scout(),
		openaiGPT5nano(),
		anthropicClaude4_5_Haiku(),
	];
	const easy: LLM | undefined = easyLLMs.find((llm) => llm.isConfigured());
	if (!easy) throw new Error('No default easy LLM configured');

	const mediumLLMs = [new FastMediumLLM(), cerebrasZaiGLM_4_6(), vertexGemini_2_5_Flash(), Gemini_2_5_Flash(), openaiGPT5mini(), anthropicClaude4_5_Haiku()];
	const medium: LLM | undefined = mediumLLMs.find((llm) => llm.isConfigured());
	if (!medium) throw new Error('No default medium LLM configured');

	const hardLLMs = [Claude4_5_Sonnet_Vertex(), openaiGPT5(), anthropicClaude4_5_Sonnet(), vertexGemini_2_5_Pro(), Gemini_2_5_Pro(), xai_Grok4()];
	const hard: LLM | undefined = hardLLMs.find((llm) => llm.isConfigured());
	if (!hard) throw new Error('No default hard LLM configured');

	const xhardLLMs = [MAD_Balanced(), MAD_Vertex(), MAD_Anthropic(), MAD_OpenAI(), MAD_Grok(), MAD_Fast()];
	const xhard = xhardLLMs.find((llm) => llm.isConfigured()) ?? hard;

	_summaryLLM = easy;
	_defaultLLMs = {
		easy,
		medium,
		hard,
		xhard,
	};

	logger.info(`Configured default LLMs: easy=${easy.getId()}, medium=${medium.getId()}, hard=${hard.getId()}, xhard=${xhard?.getId()}`);

	return _defaultLLMs;
}
