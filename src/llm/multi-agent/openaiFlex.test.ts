import type { TextStreamPart } from 'ai';
import { expect } from 'chai';
import type { GenerateTextOptions, GenerationStats, LLM, LlmMessage } from '#shared/llm/llm.model';
import { type FlexMetricsSnapshot, OPENAI_FLEX_SERVICE, OpenAIFlex } from './openaiFlex';

type GenerateHandler = (messages: LlmMessage[], opts?: GenerateTextOptions) => Promise<string>;
type StreamHandler = (messages: LlmMessage[], onChunk: (chunk: TextStreamPart<any>) => void, opts?: GenerateTextOptions) => Promise<GenerationStats>;

const DEFAULT_STATS: GenerationStats = {
	llmId: 'test:model',
	cost: 0,
	inputTokens: 0,
	outputTokens: 0,
	totalTime: 0,
	timeToFirstToken: 0,
	requestTime: 0,
	finishReason: 'stop',
};

class TestLLM implements LLM {
	constructor(
		private readonly name: string,
		private readonly model: string,
		private readonly generateHandler: GenerateHandler,
		private readonly streamHandler: StreamHandler,
		private readonly configured = true,
	) {}

	async generateText(
		userOrSystemOrMessages: string | LlmMessage[] | ReadonlyArray<LlmMessage>,
		userOrOpts?: string | GenerateTextOptions,
		opts?: GenerateTextOptions,
	): Promise<string> {
		const messages = this.toMessages(userOrSystemOrMessages, userOrOpts, opts);
		return this.generateHandler(messages, this.toOptions(userOrSystemOrMessages, userOrOpts, opts));
	}

	async generateTextWithJson(): Promise<any> {
		throw new Error('Not implemented in TestLLM');
	}

	async generateJson(): Promise<any> {
		throw new Error('Not implemented in TestLLM');
	}

	async generateTextWithResult(): Promise<string> {
		throw new Error('Not implemented in TestLLM');
	}

	async generateMessage(): Promise<LlmMessage> {
		throw new Error('Not implemented in TestLLM');
	}

	streamText(
		messages: LlmMessage[] | ReadonlyArray<LlmMessage>,
		onChunk: (chunk: TextStreamPart<any>) => void,
		opts?: GenerateTextOptions,
	): Promise<GenerationStats> {
		return this.streamHandler(messages as LlmMessage[], onChunk, opts);
	}

	getService(): string {
		return OPENAI_FLEX_SERVICE;
	}

	getModel(): string {
		return this.model;
	}

	getDisplayName(): string {
		return this.name;
	}

	getId(): string {
		return `${this.getService()}:${this.model}`;
	}

	getMaxInputTokens(): number {
		return 100_000;
	}

	getMaxOutputTokens(): number {
		return 100_000;
	}

	countTokens(): Promise<number> {
		return Promise.resolve(0);
	}

	isConfigured(): boolean {
		return this.configured;
	}

	getOldModels(): string[] {
		return [];
	}

	private toMessages(
		userOrSystemOrMessages: string | LlmMessage[] | ReadonlyArray<LlmMessage>,
		userOrOpts?: string | GenerateTextOptions,
		opts?: GenerateTextOptions,
	): LlmMessage[] {
		if (Array.isArray(userOrSystemOrMessages)) return [...userOrSystemOrMessages];
		if (typeof userOrOpts === 'string') {
			return [
				{ role: 'system', content: userOrSystemOrMessages as string },
				{ role: 'user', content: userOrOpts },
			];
		}
		return [{ role: 'user', content: userOrSystemOrMessages as string }];
	}

	private toOptions(
		userOrSystemOrMessages: string | LlmMessage[] | ReadonlyArray<LlmMessage>,
		userOrOpts?: string | GenerateTextOptions,
		opts?: GenerateTextOptions,
	): GenerateTextOptions | undefined {
		if (Array.isArray(userOrSystemOrMessages)) return userOrOpts as GenerateTextOptions | undefined;
		if (typeof userOrOpts === 'string') return opts;
		return userOrOpts as GenerateTextOptions | undefined;
	}
}

describe('OpenAIFlex', () => {
	const messages: LlmMessage[] = [{ role: 'user', content: 'hello' }];

	it('uses flex response when first chunk arrives before timeout', async () => {
		let streamed = '';
		const flexLLM = new TestLLM(
			'flex',
			'flex-model',
			async () => 'unused',
			async (_msgs, onChunk) => {
				onChunk({ type: 'text-delta', id: '1', text: 'flex-response' });
				streamed += 'flex-response';
				return DEFAULT_STATS;
			},
		);
		const standardLLM = new TestLLM(
			'standard',
			'std-model',
			async () => 'standard-response',
			async (_msgs, _onChunk) => DEFAULT_STATS,
		);

		const flex = new OpenAIFlex('Flex Under Test', 'flex-test', standardLLM, flexLLM, 200);
		const response = await flex.generateTextFromMessages(messages);
		const metrics = flex.getMetrics();

		expect(response).to.equal('flex-response');
		expect(streamed).to.equal('flex-response');
		expect(metrics.flexAttempts).to.equal(1);
		expect(metrics.flexFallbacks).to.equal(0);
		expect(metrics.flexResponses).to.equal(1);
		expect(metrics.lastFlexResponseMs).to.be.a('number');
	});

	it('falls back to standard when flex times out before first chunk', async () => {
		const flexLLM = new TestLLM(
			'flex',
			'flex-model',
			async () => 'unused',
			async (_msgs, _onChunk, opts) =>
				await new Promise<GenerationStats>((_resolve, reject) => {
					opts?.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
				}),
		);
		const standardLLM = new TestLLM(
			'standard',
			'std-model',
			async () => 'standard-response',
			async (_msgs, _onChunk) => DEFAULT_STATS,
		);

		const flex = new OpenAIFlex('Flex Under Test', 'flex-test', standardLLM, flexLLM, 50);
		const response = await flex.generateTextFromMessages(messages);
		const metrics = flex.getMetrics();

		expect(response).to.equal('standard-response');
		expect(metrics.flexAttempts).to.equal(1);
		expect(metrics.flexFallbacks).to.equal(1);
		expect(metrics.flexResponses).to.equal(0);
	});

	it('falls back if flex fails after first chunk', async () => {
		const flexLLM = new TestLLM(
			'flex',
			'flex-model',
			async () => 'unused',
			async (_msgs, onChunk) =>
				await new Promise<GenerationStats>((_resolve, reject) => {
					onChunk({ type: 'text-delta', id: '1', text: 'partial' });
					setTimeout(() => reject(new Error('boom')), 0);
				}),
		);
		const standardLLM = new TestLLM(
			'standard',
			'std-model',
			async () => 'standard-response',
			async (_msgs, _onChunk) => DEFAULT_STATS,
		);

		const flex = new OpenAIFlex('Flex Under Test', 'flex-test', standardLLM, flexLLM, 200);
		const response = await flex.generateTextFromMessages(messages);
		const metrics: FlexMetricsSnapshot = flex.getMetrics();

		expect(response).to.equal('standard-response');
		expect(metrics.flexFallbacks).to.equal(1);
		expect(metrics.flexResponses).to.equal(1);
	});

	it('streams from standard when flex times out', async () => {
		const flexLLM = new TestLLM(
			'flex',
			'flex-model',
			async () => 'unused',
			async (_msgs, _onChunk, opts) =>
				await new Promise<GenerationStats>((_resolve, reject) => {
					opts?.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
				}),
		);

		const standardLLM = new TestLLM(
			'standard',
			'std-model',
			async () => 'standard-response',
			async (_msgs, onChunk) => {
				onChunk({ type: 'text-delta', id: '1', text: 'S' });
				return DEFAULT_STATS;
			},
		);

		let streamed = '';
		const flex = new OpenAIFlex('Flex Under Test', 'flex-test', standardLLM, flexLLM, 30);
		const stats = await flex.streamText(messages, (chunk) => {
			if (chunk.type === 'text-delta') streamed += chunk.text;
		});

		expect(streamed).to.equal('S');
		expect(stats.llmId).to.equal('test:model');
		const metrics = flex.getMetrics();
		expect(metrics.flexFallbacks).to.equal(1);
	});
});
