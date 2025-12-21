import { expect } from 'chai';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { MockLLM, mockLLMs } from '#llm/services/mock-llm';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { createMockAgentContext } from '../test/fixtures';
import { type ExtractionContext, LearningExtractor } from './learningExtractor';

describe('LearningExtractor', () => {
	setupConditionalLoggerOutput();

	let extractor: LearningExtractor;
	let mockLLM: MockLLM;

	beforeEach(() => {
		initInMemoryApplicationContext();
		extractor = new LearningExtractor();
		mockLLM = mockLLMs().easy as MockLLM;
		mockLLM.reset();
	});

	afterEach(() => {
		mockLLM.reset();
	});

	describe('extract', () => {
		it('should extract learnings from context with errors', async () => {
			const context = createExtractionContext({
				errors: ['TypeError: undefined is not a function'],
				successes: ['Fixed by checking for null first'],
			});

			mockLLM.addResponse(`<json>
{
  "learnings": [
    {
      "type": "pitfall",
      "category": "typescript",
      "content": "Always check for null/undefined before calling methods",
      "confidence": 0.85,
      "tags": ["null-safety", "typescript"]
    }
  ]
}
</json>`);

			const learnings = await extractor.extract(context, mockLLM);

			expect(learnings).to.have.lengthOf(1);
			expect(learnings[0].type).to.equal('pitfall');
			expect(learnings[0].content).to.include('null');
		});

		it('should extract learnings from context with successes', async () => {
			const context = createExtractionContext({
				errors: [],
				successes: ['Used memoization for expensive calculation', 'Applied debouncing to input handler', 'Cached API response'],
			});

			mockLLM.addResponse(`<json>
{
  "learnings": [
    {
      "type": "pattern",
      "category": "performance",
      "content": "Use memoization for expensive calculations that are called frequently",
      "confidence": 0.9,
      "tags": ["performance", "optimization"]
    }
  ]
}
</json>`);

			const learnings = await extractor.extract(context, mockLLM);

			expect(learnings).to.have.lengthOf(1);
			expect(learnings[0].type).to.equal('pattern');
		});

		it('should filter out low confidence learnings', async () => {
			const context = createExtractionContext({
				errors: ['Some error'],
				successes: [],
			});

			mockLLM.addResponse(
				JSON.stringify({
					learnings: [
						{ type: 'pattern', category: 'test', content: 'Low confidence', confidence: 0.5, tags: [] },
						{ type: 'pattern', category: 'test', content: 'High confidence', confidence: 0.9, tags: [] },
					],
				}),
			);

			const learnings = await extractor.extract(context, mockLLM);

			expect(learnings).to.have.lengthOf(1);
			expect(learnings[0].content).to.equal('High confidence');
		});

		it('should limit number of learnings extracted', async () => {
			const limitedExtractor = new LearningExtractor({ maxLearningsPerExtraction: 2 });
			const context = createExtractionContext({
				errors: ['error1', 'error2', 'error3'],
				successes: [],
			});

			mockLLM.addResponse(
				JSON.stringify({
					learnings: [
						{ type: 'pitfall', category: 'a', content: 'Learning 1', confidence: 0.9, tags: [] },
						{ type: 'pitfall', category: 'b', content: 'Learning 2', confidence: 0.9, tags: [] },
						{ type: 'pitfall', category: 'c', content: 'Learning 3', confidence: 0.9, tags: [] },
						{ type: 'pitfall', category: 'd', content: 'Learning 4', confidence: 0.9, tags: [] },
					],
				}),
			);

			const learnings = await limitedExtractor.extract(context, mockLLM);

			expect(learnings).to.have.lengthOf(2);
		});

		it('should return empty array when not enough data', async () => {
			const context = createExtractionContext({
				errors: [],
				successes: ['only one success'], // Less than 3 successes and no errors
			});

			const learnings = await extractor.extract(context, mockLLM);

			expect(learnings).to.have.lengthOf(0);
			expect(mockLLM.getCallCount()).to.equal(0); // Should not even call LLM
		});

		it('should include source information in learnings', async () => {
			const agent = createMockAgentContext();
			agent.agentId = 'test-agent-123';
			agent.userPrompt = 'Fix authentication bug';
			agent.iterations = 5;
			agent.lastCompactionIteration = 2;

			const context = createExtractionContext({
				errors: ['Some error'],
				agent,
			});

			mockLLM.addResponse(
				JSON.stringify({
					learnings: [{ type: 'pitfall', category: 'auth', content: 'Learning', confidence: 0.8, tags: [] }],
				}),
			);

			const learnings = await extractor.extract(context, mockLLM);

			expect(learnings[0].source.agentId).to.equal('test-agent-123');
			expect(learnings[0].source.task).to.include('authentication');
			expect(learnings[0].source.iterationRange).to.deep.equal({ start: 3, end: 5 });
		});

		it('should set outcome based on errors', async () => {
			const contextWithErrors = createExtractionContext({
				errors: ['Some error'],
				successes: ['Some success', 'Another', 'Third'],
			});

			const contextWithoutErrors = createExtractionContext({
				errors: [],
				successes: ['Success 1', 'Success 2', 'Success 3'],
			});

			mockLLM.addResponse(JSON.stringify({ learnings: [{ type: 'pitfall', category: 'a', content: 'L1', confidence: 0.8, tags: [] }] }));
			mockLLM.addResponse(JSON.stringify({ learnings: [{ type: 'pattern', category: 'b', content: 'L2', confidence: 0.8, tags: [] }] }));

			const learningsWithErrors = await extractor.extract(contextWithErrors, mockLLM);
			const learningsWithoutErrors = await extractor.extract(contextWithoutErrors, mockLLM);

			expect(learningsWithErrors[0].source.outcome).to.equal('partial');
			expect(learningsWithoutErrors[0].source.outcome).to.equal('success');
		});

		it('should handle LLM errors gracefully', async () => {
			const context = createExtractionContext({
				errors: ['error'],
			});

			mockLLM.rejectNextText(new Error('LLM failed'));

			const learnings = await extractor.extract(context, mockLLM);

			expect(learnings).to.have.lengthOf(0);
		});

		it('should handle malformed JSON response', async () => {
			const context = createExtractionContext({
				errors: ['error'],
			});

			mockLLM.addResponse('This is not valid JSON at all');

			const learnings = await extractor.extract(context, mockLLM);

			expect(learnings).to.have.lengthOf(0);
		});
	});

	describe('extractFromErrors', () => {
		it('should extract pitfalls from errors and resolutions', async () => {
			const errors = [
				{ error: 'Cannot find module ./utils', resolution: 'Fixed by using correct relative path' },
				{ error: 'Property x does not exist on type Y', resolution: 'Added type guard before access' },
			];

			mockLLM.addResponse(`<json>
{
  "learnings": [
    {
      "type": "pitfall",
      "category": "imports",
      "content": "Always verify relative import paths when moving files",
      "confidence": 0.85,
      "tags": ["imports", "typescript"]
    }
  ]
}
</json>`);

			const learnings = await extractor.extractFromErrors(errors, { task: 'Fix imports', agentId: 'agent-1' }, mockLLM);

			expect(learnings).to.have.lengthOf(1);
			expect(learnings[0].type).to.equal('pitfall');
		});

		it('should return empty array when no errors provided', async () => {
			const learnings = await extractor.extractFromErrors([], { task: 'Test', agentId: 'agent-1' }, mockLLM);

			expect(learnings).to.have.lengthOf(0);
			expect(mockLLM.getCallCount()).to.equal(0);
		});
	});

	describe('extractFromCodeChanges', () => {
		it('should extract patterns from code changes', async () => {
			const changes = [
				{
					file: 'src/auth.ts',
					before: 'if (user) { return user.name }',
					after: 'if (user?.name) { return user.name }',
					reason: 'Added optional chaining for safety',
				},
			];

			mockLLM.addResponse(`<json>
{
  "learnings": [
    {
      "type": "pattern",
      "category": "typescript/safety",
      "content": "Use optional chaining when accessing nested properties",
      "confidence": 0.9,
      "tags": ["typescript", "optional-chaining"]
    }
  ]
}
</json>`);

			const learnings = await extractor.extractFromCodeChanges(changes, { task: 'Improve safety', agentId: 'agent-1' }, mockLLM);

			expect(learnings).to.have.lengthOf(1);
			expect(learnings[0].type).to.equal('pattern');
			expect(learnings[0].category).to.equal('typescript/safety');
		});

		it('should return empty array when no changes provided', async () => {
			const learnings = await extractor.extractFromCodeChanges([], { task: 'Test', agentId: 'agent-1' }, mockLLM);

			expect(learnings).to.have.lengthOf(0);
			expect(mockLLM.getCallCount()).to.equal(0);
		});
	});

	describe('getConfig', () => {
		it('should return copy of config', () => {
			const customExtractor = new LearningExtractor({
				minConfidence: 0.8,
				maxLearningsPerExtraction: 3,
			});

			const config = customExtractor.getConfig();

			expect(config.minConfidence).to.equal(0.8);
			expect(config.maxLearningsPerExtraction).to.equal(3);
		});

		it('should use default values when not specified', () => {
			const config = extractor.getConfig();

			expect(config.minConfidence).to.equal(0.7);
			expect(config.maxLearningsPerExtraction).to.equal(5);
			expect(config.focusCategories).to.deep.equal([]);
		});
	});
});

// Helper function
function createExtractionContext(overrides: Partial<ExtractionContext> & { errors?: string[]; successes?: string[] }): ExtractionContext {
	return {
		summary: 'Completed work summary',
		errors: overrides.errors ?? [],
		successes: overrides.successes ?? [],
		compactedMessages: [],
		agent: overrides.agent ?? createMockAgentContext(),
	};
}
