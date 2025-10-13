import { expect } from 'chai';
import { agentContextStorage } from '#agent/agentContextLocalStorage';
import type { AgentContext } from '#shared/agent/agent.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { Perplexity } from './perplexity';

describe('Perplexity Integration Tests', () => {
	setupConditionalLoggerOutput();

	let perplexity: Perplexity;
	let mockAgentContext: AgentContext;

	beforeEach(() => {
		perplexity = new Perplexity();
		mockAgentContext = {
			agentId: 'test-agent-id',
			memory: {},
		} as AgentContext;
	});

	describe('research', () => {
		it('should perform research and return results when saveToMemory is false', async function () {
			this.timeout(30000);

			const researchTask = 'What are the latest TypeScript 5.9 features?';

			const result = await agentContextStorage.run(mockAgentContext, async () => {
				return await perplexity.research(researchTask, false);
			});

			expect(result).to.be.a('string');
			expect(result.length).to.be.greaterThan(0);
			expect(result).to.include('TypeScript');
		});

		it('should save research to memory and return memory key when saveToMemory is true', async function () {
			this.timeout(30000);

			const researchTask = 'What is the capital of France?';

			const memoryKey = await agentContextStorage.run(mockAgentContext, async () => {
				return await perplexity.research(researchTask, true);
			});

			expect(memoryKey).to.be.a('string');
			expect(memoryKey).to.match(/^Perplexity-/);
			expect(mockAgentContext.memory[memoryKey]).to.be.a('string');
			expect(mockAgentContext.memory[memoryKey].length).to.be.greaterThan(0);
		});

		it('should handle complex research queries', async function () {
			this.timeout(30000);

			const researchTask = 'Compare the performance characteristics of Node.js async/await versus callbacks in 2025';

			const result = await agentContextStorage.run(mockAgentContext, async () => {
				return await perplexity.research(researchTask, false);
			});

			expect(result).to.be.a('string');
			expect(result.length).to.be.greaterThan(100);
		});

		it('should handle short queries', async function () {
			this.timeout(30000);

			const researchTask = 'TypeScript';

			const result = await agentContextStorage.run(mockAgentContext, async () => {
				return await perplexity.research(researchTask, false);
			});

			expect(result).to.be.a('string');
			expect(result.length).to.be.greaterThan(0);
		});
	});

	describe('search', () => {
		it('should perform basic web search and return results', async function () {
			this.timeout(30000);

			const result = await agentContextStorage.run(mockAgentContext, async () => {
				return await perplexity.search('TypeScript 5.9 features', {
					max_results: 5,
				});
			});

			expect(result).to.have.property('results');
			expect(result.results).to.be.an('array');
			expect(result.results.length).to.be.greaterThan(0);
			expect(result.results.length).to.be.at.most(5);

			const firstResult = result.results[0];
			expect(firstResult).to.have.property('title');
			expect(firstResult).to.have.property('url');
			expect(firstResult.title).to.be.a('string');
			expect(firstResult.url).to.be.a('string');
		});

		it('should support multi-query search', async function () {
			this.timeout(30000);

			const result = await agentContextStorage.run(mockAgentContext, async () => {
				return await perplexity.search(['Node.js performance', 'JavaScript async patterns'], {
					max_results: 10,
				});
			});

			expect(result.results).to.be.an('array');
			expect(result.results.length).to.be.greaterThan(0);
		});

		it('should return snippets when requested', async function () {
			this.timeout(30000);

			const result = await agentContextStorage.run(mockAgentContext, async () => {
				return await perplexity.search('React best practices 2025', {
					max_results: 3,
					return_snippets: true,
				});
			});

			expect(result.results).to.be.an('array');
			expect(result.results.length).to.be.greaterThan(0);

			const resultsWithSnippets = result.results.filter((r) => r.snippet);
			expect(resultsWithSnippets.length).to.be.greaterThan(0);
		});

		it('should support country filtering', async function () {
			this.timeout(30000);

			const result = await agentContextStorage.run(mockAgentContext, async () => {
				return await perplexity.search('local tech events', {
					max_results: 5,
					country: 'US',
				});
			});

			expect(result.results).to.be.an('array');
			expect(result.results.length).to.be.greaterThan(0);
		});

		it('should handle errors gracefully', async function () {
			this.timeout(30000);

			await agentContextStorage.run(mockAgentContext, async () => {
				try {
					await perplexity.search('', {
						max_results: 5,
					});
					expect.fail('Should have thrown an error');
				} catch (error) {
					expect(error).to.exist;
				}
			});
		});
	});
});
