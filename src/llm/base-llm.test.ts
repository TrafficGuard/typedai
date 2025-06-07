import { expect } from 'chai';
import type { LlmMessage } from '#shared/llm/llm.model';
import { BaseLLM } from './base-llm';

// Create a concrete subclass of BaseLLM for testing
class TestLLM extends BaseLLM {
	constructor() {
		super('Test LLM', 'test-service', 'test-model', 1000, () => ({
			inputCost: 0,
			outputCost: 0,
			totalCost: 0,
		}));
	}

	// Expose the protected method for testing
	public parseParameters(userOrSystemOrMessages: string | LlmMessage[], userOrOptions?: string | any, opts?: any) {
		return this.parseGenerateTextParameters(userOrSystemOrMessages, userOrOptions, opts);
	}
}

describe('BaseLLM.parseGenerateTextParameters', () => {
	const testLLM = new TestLLM();

	it('should handle userPrompt and opts', () => {
		const userPrompt = 'Hello, how are you?';
		const options = { temperature: 0.7 };
		const result = testLLM.parseParameters(userPrompt, options);

		expect(result.messages).to.deep.equal([{ role: 'user', content: userPrompt }]);
		expect(result.options).to.deep.equal(options);
	});

	it('should handle systemPrompt, userPrompt, and opts', () => {
		const systemPrompt = 'You are a helpful assistant.';
		const userPrompt = 'Tell me a joke.';
		const options = { temperature: 0.5 };
		const result = testLLM.parseParameters(systemPrompt, userPrompt, options);

		expect(result.messages).to.deep.equal([
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		]);
		expect(result.options).to.equal(options);
	});

	it('should handle messages array and opts', () => {
		const messages: LlmMessage[] = [
			{ role: 'system', content: 'You are a calculator.' },
			{ role: 'user', content: 'What is 2 + 2?' },
		];
		const options = { temperature: 0 };
		const result = testLLM.parseParameters(messages, options);

		expect(result.messages).to.deep.equal(messages);
		expect(result.options).to.equal(options);
	});

	it('should handle only userPrompt', () => {
		const userPrompt = 'What is the weather today?';
		const result = testLLM.parseParameters(userPrompt);

		expect(result.messages).to.deep.equal([{ role: 'user', content: userPrompt }]);
		expect(result.options).to.be.undefined;
	});

	it('should handle messages array without options', () => {
		const messages: LlmMessage[] = [
			{ role: 'user', content: 'Hi there!' },
			{ role: 'assistant', content: 'Hello!' },
		];
		const result = testLLM.parseParameters(messages);
		expect(result.messages).to.deep.equal(messages);
		expect(result.options).to.be.undefined;
	});

	describe.skip('Additional test cases for edge cases and invalid inputs', () => {
		// AI generated, need to be fixed
		it('should throw an error when userPrompt is undefined', () => {
			const userPrompt = undefined;
			expect(() => testLLM.parseParameters(userPrompt as any)).to.throw(Error);
		});

		it('should throw an error when userPrompt is empty', () => {
			const userPrompt = '';
			expect(() => testLLM.parseParameters(userPrompt as any)).to.throw(Error);
		});

		it('should throw an error when no prompts are provided', () => {
			const options = { temperature: 0.7 };
			expect(() => testLLM.parseParameters(undefined as any, options)).to.throw(Error);
		});

		it('should throw an error for invalid message role', () => {
			const messages: LlmMessage[] = [{ role: 'invalid_role' as any, content: 'This role is invalid.' }];
			expect(() => testLLM.parseParameters(messages)).to.throw(Error);
		});

		it('should throw an error when arguments have incorrect types', () => {
			const userPrompt = 12345; // Incorrect type
			expect(() => testLLM.parseParameters(userPrompt as any)).to.throw(Error);
		});
	});
});
