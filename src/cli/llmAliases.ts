import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { openAIFlexGPT5Mini } from '#llm/multi-agent/openaiFlex';
import { MAD_Balanced, MAD_Fast, MAD_SOTA } from '#llm/multi-agent/reasoning-debate';
import { Claude4_5_Opus_Vertex } from '#llm/services/anthropic-vertex';
import { cerebrasQwen3_235b_Thinking, cerebrasZaiGLM_4_6 } from '#llm/services/cerebras';
import { claudeCodeSonnet } from '#llm/services/claudeCode';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { openaiGPT5, openaiGPT5flex, openaiGPT5mini, openaiGPT5nano, openaiGPT5priority } from '#llm/services/openai';
import { perplexityDeepResearchLLM, perplexityLLM, perplexityReasoningProLLM } from '#llm/services/perplexity-llm';
import { xai_Grok4, xai_Grok4_Fast_Instruct, xai_Grok4_Fast_Reasoning } from '#llm/services/xai';
import { LLM } from '#shared/llm/llm.model';

export const LLM_CLI_ALIAS: Record<string, () => LLM> = {
	e: () => defaultLLMs().easy,
	m: () => defaultLLMs().medium,
	h: () => defaultLLMs().hard,
	xh: () => defaultLLMs().xhard!,
	fm: () => new FastMediumLLM(),
	c: cerebrasZaiGLM_4_6,
	cc: claudeCodeSonnet,
	g5: openaiGPT5,
	g5p: openaiGPT5priority,
	g5mf: openAIFlexGPT5Mini,
	gpt5: openaiGPT5,
	g5m: openaiGPT5mini,
	g5n: openaiGPT5nano,
	madb: MAD_Balanced,
	mads: MAD_SOTA,
	madf: MAD_Fast,
	opus: Claude4_5_Opus_Vertex,
	pp1: perplexityLLM,
	pp2: perplexityReasoningProLLM,
	pp3: perplexityDeepResearchLLM,
	x: xai_Grok4,
	xf: xai_Grok4_Fast_Instruct,
	xfr: xai_Grok4_Fast_Reasoning,
};
