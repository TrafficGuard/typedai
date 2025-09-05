import OpenAI from 'openai';
import { addCost } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { currentUser } from '#user/userContext';

/*
https://docs.morphllm.com/guides/quickstart
https://news.ycombinator.com/item?id=44490863

Fast Apply Models
morph-v3-fast
Fastest model
4500+ tok/sec
16k input tokens, 16k output tokens
Input:
$0.8/1M tokens
Output:
$1.2/1M tokens

morph-v3-large
Most capable
2500+ tok/sec
16k input tokens, 16k output tokens
Input:
$0.9/1M tokens
Output:
$1.9/1M tokens
*/

function fastCost(usage) {
	return (usage.prompt_tokens * 0.8) / 1_000_000 + (usage.completion_tokens * 1.2) / 1_000_000;
}

function largeCost(usage) {
	return (usage.prompt_tokens * 0.9) / 1_000_000 + (usage.completion_tokens * 1.9) / 1_000_000;
}

export class MorphAPI {
	openai: OpenAI;

	@span()
	async edit(initialCode: string, editSnippet: string, instructions?: string): Promise<string> {
		// const apiKey = currentUser()?.llmConfig.morphKey || process.env.MORPH_API_KEY;
		if (!process.env.MORPH_API_KEY) throw new Error('MORPH_API_KEY is not set');
		this.openai ??= new OpenAI({
			apiKey: process.env.MORPH_API_KEY,
			baseURL: 'https://api.morphllm.com/v1',
		});

		const useLargeModel = false;
		const model = useLargeModel ? 'morph-v3-large' : 'morph-v3-fast';

		const startTime = Date.now();

		const instructionsContent = instructions ? `<instruction>${instructions}</instruction>\n` : '';
		const content = `${instructionsContent}<code>${initialCode}</code>\n<update>${editSnippet}</update>`;

		const response = await this.openai.chat.completions.create({
			model,
			messages: [
				{
					role: 'user',
					content,
				},
			],
		});
		const endTime = Date.now();
		const duration = (endTime - startTime) / 1000;
		// logger.info({ duration }, 'Morph edit duration (ms)');
		// logger.info(response.usage);
		const inputTokens = response.usage.prompt_tokens;
		const outputTokens = response.usage.completion_tokens;
		const cost = useLargeModel ? largeCost(response.usage) : fastCost(response.usage);
		console.log(`Morph edit cost: $${cost}`);
		addCost(cost);

		const mergedCode = response.choices[0].message.content;
		return mergedCode;
	}
}
