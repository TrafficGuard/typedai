import { expect } from 'chai';
import { type BatchPredictionResponse, aggregateBatchCosts, calculateBatchCost, createJsonBatchRequest, extractBatchResponseText } from './vertexBatch';

describe('vertexBatch', () => {
	describe('createJsonBatchRequest', () => {
		it('should create a basic batch request', () => {
			const request = createJsonBatchRequest('test-id', 'Generate a summary');

			expect(request.customId).to.equal('test-id');
			expect(request.request.contents).to.have.lengthOf(1);
			expect(request.request.contents[0].role).to.equal('user');
			expect(request.request.contents[0].parts[0].text).to.equal('Generate a summary');
			expect(request.request.generationConfig?.responseMimeType).to.equal('application/json');
			expect(request.request.generationConfig?.temperature).to.equal(0);
		});

		it('should include system instruction when provided', () => {
			const request = createJsonBatchRequest('test-id', 'User prompt', 'You are a helpful assistant');

			expect(request.request.systemInstruction).to.exist;
			expect(request.request.systemInstruction?.parts[0].text).to.equal('You are a helpful assistant');
		});

		it('should not include system instruction when not provided', () => {
			const request = createJsonBatchRequest('test-id', 'User prompt');

			expect(request.request.systemInstruction).to.be.undefined;
		});
	});

	describe('extractBatchResponseText', () => {
		it('should extract text from successful response', () => {
			const response: BatchPredictionResponse = {
				customId: 'test-id',
				status: 'success',
				response: {
					candidates: [
						{
							content: {
								parts: [{ text: '{"short": "Test", "long": "Test summary"}' }],
								role: 'model',
							},
							finishReason: 'STOP',
						},
					],
					usageMetadata: {
						promptTokenCount: 100,
						candidatesTokenCount: 50,
						totalTokenCount: 150,
					},
				},
			};

			const text = extractBatchResponseText(response);

			expect(text).to.equal('{"short": "Test", "long": "Test summary"}');
		});

		it('should return null for error response', () => {
			const response: BatchPredictionResponse = {
				customId: 'test-id',
				status: 'error',
				error: {
					code: 500,
					message: 'Internal error',
				},
			};

			const text = extractBatchResponseText(response);

			expect(text).to.be.null;
		});

		it('should return null when no candidates', () => {
			const response: BatchPredictionResponse = {
				customId: 'test-id',
				status: 'success',
				response: {
					candidates: [],
				},
			};

			const text = extractBatchResponseText(response);

			expect(text).to.be.null;
		});

		it('should concatenate multiple parts', () => {
			const response: BatchPredictionResponse = {
				customId: 'test-id',
				status: 'success',
				response: {
					candidates: [
						{
							content: {
								parts: [{ text: 'Part 1 ' }, { text: 'Part 2' }],
								role: 'model',
							},
							finishReason: 'STOP',
						},
					],
				},
			};

			const text = extractBatchResponseText(response);

			expect(text).to.equal('Part 1 Part 2');
		});
	});

	describe('calculateBatchCost', () => {
		it('should calculate cost with 50% batch discount', () => {
			// gemini-2.5-flash: $0.30/M input, $2.50/M output
			// With 50% discount: $0.15/M input, $1.25/M output
			const result = calculateBatchCost('gemini-2.5-flash', 1_000_000, 100_000);

			// Input: 1M tokens * $0.30/M * 0.5 = $0.15
			// Output: 100K tokens * $2.50/M * 0.5 = $0.125
			expect(result.inputCost).to.be.closeTo(0.15, 0.001);
			expect(result.outputCost).to.be.closeTo(0.125, 0.001);
			expect(result.totalCost).to.be.closeTo(0.275, 0.001);
		});

		it('should handle unknown model by falling back to gemini-2.5-flash pricing', () => {
			const result = calculateBatchCost('unknown-model-xyz', 1_000_000, 100_000);

			// Should use gemini-2.5-flash pricing as fallback
			expect(result.inputCost).to.be.closeTo(0.15, 0.001);
			expect(result.outputCost).to.be.closeTo(0.125, 0.001);
		});

		it('should match model by prefix', () => {
			// Model with version suffix should match base model
			const result = calculateBatchCost('gemini-2.5-flash-preview-123', 1_000_000, 100_000);

			// Should use gemini-2.5-flash pricing
			expect(result.inputCost).to.be.closeTo(0.15, 0.001);
			expect(result.outputCost).to.be.closeTo(0.125, 0.001);
		});

		it('should calculate correctly for gemini-2.5-pro', () => {
			// gemini-2.5-pro: $1.25/M input, $10/M output
			// With 50% discount: $0.625/M input, $5/M output
			const result = calculateBatchCost('gemini-2.5-pro', 1_000_000, 100_000);

			expect(result.inputCost).to.be.closeTo(0.625, 0.001);
			expect(result.outputCost).to.be.closeTo(0.5, 0.001);
			expect(result.totalCost).to.be.closeTo(1.125, 0.001);
		});

		it('should apply cached token discount', () => {
			// gemini-2.5-flash: $0.30/M input, $0.075/M cached (explicit), $2.50/M output
			// With 50% batch discount: $0.15/M input, $0.0375/M cached, $1.25/M output
			// 500K standard + 500K cached = 1M total input
			const result = calculateBatchCost('gemini-2.5-flash', 1_000_000, 100_000, 500_000);

			// Input: (500K * $0.30 + 500K * $0.075) / 1M * 0.5 = $0.09375
			// Output: 100K * $2.50 / 1M * 0.5 = $0.125
			expect(result.inputCost).to.be.closeTo(0.09375, 0.001);
			expect(result.outputCost).to.be.closeTo(0.125, 0.001);
			expect(result.totalCost).to.be.closeTo(0.21875, 0.001);
		});

		it('should use default cached rate (25% of input) when not specified', () => {
			// gemini-2.5-pro: $1.25/M input, no explicit cached rate
			// Default cached = 25% of input = $0.3125/M
			// With 50% batch discount: $0.625/M input, $0.15625/M cached
			const result = calculateBatchCost('gemini-2.5-pro', 1_000_000, 100_000, 500_000);

			// Input: (500K * $1.25 + 500K * $0.3125) / 1M * 0.5 = $0.390625
			// Output: 100K * $10 / 1M * 0.5 = $0.5
			expect(result.inputCost).to.be.closeTo(0.390625, 0.001);
			expect(result.outputCost).to.be.closeTo(0.5, 0.001);
		});

		it('should handle zero tokens', () => {
			const result = calculateBatchCost('gemini-2.5-flash', 0, 0, 0);

			expect(result.inputCost).to.equal(0);
			expect(result.outputCost).to.equal(0);
			expect(result.totalCost).to.equal(0);
		});

		it('should handle all cached tokens (no standard input)', () => {
			// All 1M tokens are cached
			const result = calculateBatchCost('gemini-2.5-flash', 1_000_000, 100_000, 1_000_000);

			// Input: (0 * $0.30 + 1M * $0.075) / 1M * 0.5 = $0.0375
			// Output: 100K * $2.50 / 1M * 0.5 = $0.125
			expect(result.inputCost).to.be.closeTo(0.0375, 0.001);
			expect(result.outputCost).to.be.closeTo(0.125, 0.001);
		});
	});

	describe('aggregateBatchCosts', () => {
		it('should aggregate costs from multiple responses', () => {
			const responses: BatchPredictionResponse[] = [
				{
					customId: 'file1',
					status: 'success',
					response: {
						candidates: [{ content: { parts: [{ text: 'test' }], role: 'model' }, finishReason: 'STOP' }],
						usageMetadata: {
							promptTokenCount: 1000,
							candidatesTokenCount: 500,
							totalTokenCount: 1500,
						},
					},
				},
				{
					customId: 'file2',
					status: 'success',
					response: {
						candidates: [{ content: { parts: [{ text: 'test' }], role: 'model' }, finishReason: 'STOP' }],
						usageMetadata: {
							promptTokenCount: 2000,
							candidatesTokenCount: 1000,
							totalTokenCount: 3000,
						},
					},
				},
			];

			const stats = aggregateBatchCosts(responses, 'gemini-2.5-flash');

			expect(stats.totalInputTokens).to.equal(3000);
			expect(stats.totalOutputTokens).to.equal(1500);
			expect(stats.requestCount).to.equal(2);
			expect(stats.successCount).to.equal(2);
			expect(stats.failureCount).to.equal(0);
			expect(stats.totalCost).to.be.greaterThan(0);
		});

		it('should track failed responses', () => {
			const responses: BatchPredictionResponse[] = [
				{
					customId: 'file1',
					status: 'success',
					response: {
						candidates: [{ content: { parts: [{ text: 'test' }], role: 'model' }, finishReason: 'STOP' }],
						usageMetadata: {
							promptTokenCount: 1000,
							candidatesTokenCount: 500,
							totalTokenCount: 1500,
						},
					},
				},
				{
					customId: 'file2',
					status: 'error',
					error: {
						code: 500,
						message: 'Internal error',
					},
				},
			];

			const stats = aggregateBatchCosts(responses, 'gemini-2.5-flash');

			expect(stats.requestCount).to.equal(2);
			expect(stats.successCount).to.equal(1);
			expect(stats.failureCount).to.equal(1);
			expect(stats.totalInputTokens).to.equal(1000);
			expect(stats.totalOutputTokens).to.equal(500);
		});

		it('should handle responses without usage metadata', () => {
			const responses: BatchPredictionResponse[] = [
				{
					customId: 'file1',
					status: 'success',
					response: {
						candidates: [{ content: { parts: [{ text: 'test' }], role: 'model' }, finishReason: 'STOP' }],
						// No usageMetadata
					},
				},
			];

			const stats = aggregateBatchCosts(responses, 'gemini-2.5-flash');

			expect(stats.successCount).to.equal(1);
			expect(stats.totalInputTokens).to.equal(0);
			expect(stats.totalOutputTokens).to.equal(0);
			expect(stats.totalCost).to.equal(0);
		});
	});
});
