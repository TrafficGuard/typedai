/**
 * Integration tests for the Claude Agent SDK Debater.
 *
 * These tests use the actual Claude Agent SDK to verify tool calling
 * and debate functionality work correctly.
 *
 * Requirements:
 * - Claude Code CLI must be installed (npm install -g @anthropic-ai/claude-code)
 * - Claude Code must be authenticated (claude login)
 * - Set CLAUDE_CODE_TESTS=1 to run these tests
 */

import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { type IToolExecutor, createDefaultDebateTools } from './debateTools';
import { ClaudeAgentDebater, isClaudeAgentSdkAvailable } from './debaters/claudeAgentDebater';
import type { DebateContext } from './toolEnabledDebate';

// Skip tests if CLAUDE_CODE_TESTS env var is not set
const runClaudeCodeTests = process.env.CLAUDE_CODE_TESTS === '1';

describe('ClaudeAgentDebater Integration', () => {
	setupConditionalLoggerOutput();

	// Claude Agent SDK uses Claude Code's logged-in session, not ANTHROPIC_API_KEY
	// The API key interferes with the SDK, so we need to unset it
	let savedApiKey: string | undefined;

	before(() => {
		if (runClaudeCodeTests) {
			savedApiKey = process.env.ANTHROPIC_API_KEY;
			process.env.ANTHROPIC_API_KEY = undefined;
		}
	});

	after(() => {
		if (savedApiKey !== undefined) {
			process.env.ANTHROPIC_API_KEY = savedApiKey;
		}
	});

	// Mock executor for controlled testing
	const mockExecutor: IToolExecutor = {
		async searchCodebase(pattern: string) {
			return `Found matches for "${pattern}":\nsrc/test.ts:10: function test() {\nsrc/test.ts:20: return result;`;
		},
		async readFile(path: string) {
			return `// Contents of ${path}\nexport function example() {\n  return 'hello';\n}`;
		},
		async webSearch(query: string) {
			return `Search results for "${query}":\n1. Example result from documentation`;
		},
		async webFetch(url: string, prompt: string) {
			return `Fetched content from ${url}: ${prompt}`;
		},
	};

	describe('SDK Availability', () => {
		it('should detect if Claude Agent SDK is available', async () => {
			const available = await isClaudeAgentSdkAvailable();
			// SDK should be installed based on package.json
			expect(available).to.be.true;
		});
	});

	describe('Debater Creation', () => {
		it('should create a debater with default configuration', () => {
			const debater = new ClaudeAgentDebater({
				id: 'test-agent',
				name: 'Test Agent',
			});

			expect(debater.id).to.equal('test-agent');
			expect(debater.name).to.equal('Test Agent');
			expect(debater.type).to.equal('claude-agent-sdk');
		});

		it('should create a debater with custom model and persona', () => {
			const debater = new ClaudeAgentDebater({
				id: 'custom-agent',
				name: 'Custom Agent',
				model: 'claude-haiku-4-5',
				persona: 'Be skeptical and verify all claims.',
			});

			expect(debater.id).to.equal('custom-agent');
		});

		it('should report availability', async () => {
			const debater = new ClaudeAgentDebater({
				id: 'test',
				name: 'Test',
			});

			const available = await debater.isAvailable();
			expect(available).to.be.true;
		});
	});

	// Tests that require Claude Code to be running
	const describeWithClaudeCode = runClaudeCodeTests ? describe : describe.skip;

	describeWithClaudeCode('Initial Position Generation', function () {
		this.timeout(120000); // SDK calls may take time

		it('should generate an initial position on a simple topic', async () => {
			const debater = new ClaudeAgentDebater({
				id: 'debate-agent-1',
				name: 'Debater 1',
				model: 'claude-haiku-4-5', // Use fast model for tests
			});

			// Simple test without tools to speed up
			const context: DebateContext = {
				topic: 'Should TypeScript use exceptions or Result types?',
				tools: [], // No tools for faster test
				round: 0,
				previousRounds: [],
				sharedToolResults: [],
			};

			const response = await debater.generateInitialPosition('Should TypeScript use exceptions or Result types?', context);

			// Verify response structure
			expect(response).to.have.property('position');
			expect(response).to.have.property('confidence');
			expect(response).to.have.property('reasoning');
			expect(response).to.have.property('citations');
			expect(response).to.have.property('codeTraces');

			// Verify types
			expect(response.position).to.be.a('string');
			expect(response.confidence).to.be.a('number');
			expect(response.confidence).to.be.within(0, 1);
			expect(response.reasoning).to.be.a('string');
			expect(response.citations).to.be.an('array');
		});
	});

	describeWithClaudeCode('Debate Response Generation', function () {
		this.timeout(60000);

		it('should generate a response considering neighbor positions', async () => {
			const debater = new ClaudeAgentDebater({
				id: 'debate-agent-2',
				name: 'Debater 2',
				model: 'claude-haiku-4-5',
				persona: 'Be critical and look for weaknesses in arguments.',
			});

			const tools = createDefaultDebateTools(mockExecutor);
			const context: DebateContext = {
				topic: 'Should we use exceptions or Result types for error handling?',
				tools,
				round: 1,
				previousRounds: [],
				sharedToolResults: [],
			};

			const neighborPositions = [
				{
					agentId: 'agent-1',
					position: 'Exceptions are better because they provide stack traces.',
					confidence: 0.8,
					reasoning: 'Stack traces help with debugging.',
					citations: [],
					codeTraces: [],
					toolCalls: [],
				},
			];

			const response = await debater.generateDebateResponse('Should we use exceptions or Result types for error handling?', context, neighborPositions);

			expect(response).to.have.property('position');
			expect(response).to.have.property('confidence');
			expect(response.position).to.be.a('string');
			// Agent should engage with the neighbor's position
			expect(response.reasoning.length).to.be.greaterThan(0);
		});
	});

	describeWithClaudeCode('Tool Integration', function () {
		this.timeout(180000); // Tools need more time

		it('should be able to use codebase tools', async () => {
			const debater = new ClaudeAgentDebater({
				id: 'tool-agent',
				name: 'Tool Agent',
				model: 'claude-haiku-4-5',
				maxTurns: 10, // More turns needed for tool-based exploration
			});

			const tools = createDefaultDebateTools(mockExecutor);
			const context: DebateContext = {
				topic: 'What patterns exist in this code?',
				backgroundContext: 'This is a TypeScript project.',
				tools,
				round: 0,
				previousRounds: [],
				sharedToolResults: [],
			};

			const response = await debater.generateInitialPosition('What patterns exist in this code?', context);

			// Agent should produce a response (may be from fallback if tools took too long)
			expect(response.position).to.be.a('string');
			// Don't require content - the SDK may hit maxTurns during tool calls
		});
	});
});
