import { expect } from 'chai';
import sinon from 'sinon';
import type { LLM } from '#shared/llm/llm.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { mockLLM, mockLLMs } from '../services/mock-llm';
import { DebateCoordinator, runDebate } from './debateCoordinator';
import {
	buildConsensusCheckPrompt,
	buildDebateRoundPrompt,
	buildInitialPositionPrompt,
	buildSynthesisPrompt,
	buildVerificationPrompt,
	extractJsonFromResponse,
	formatCitations,
	formatNeighborPositions,
	parseConsensusResponse,
} from './debatePrompts';
import {
	type IToolExecutor,
	createCodebaseSearchTool,
	createDebateTool,
	createDefaultDebateTools,
	createReadFileTool,
	executeToolRequests,
	formatToolResultsForPrompt,
	wrapToolExecution,
} from './debateTools';
import { extractClaimsFromAnswer, freshVerificationPass, quickVerifyHasCitations } from './debateVerification';
import { LlmDebater, createDebater, createDebaters, createLlmDebater } from './debaters';
import type { Citation, DebateConfig, DebateContext, DebatePosition, DebateTool, SynthesizedAnswer } from './toolEnabledDebate';

describe('agentic-debate', () => {
	setupConditionalLoggerOutput();

	const sandbox = sinon.createSandbox();

	beforeEach(() => {
		mockLLM.reset();
	});

	afterEach(() => {
		sandbox.restore();
	});

	// ========================================================================
	// debateTools.ts tests
	// ========================================================================

	describe('debateTools', () => {
		describe('createDebateTool', () => {
			it('should create a tool with all properties', () => {
				const tool = createDebateTool({
					name: 'test_tool',
					sdkName: 'TestTool',
					description: 'A test tool',
					parameters: {
						param1: { type: 'string', description: 'A param', required: true },
					},
					execute: async () => ({ success: true, data: 'result' }),
				});

				expect(tool.name).to.equal('test_tool');
				expect(tool.sdkName).to.equal('TestTool');
				expect(tool.description).to.equal('A test tool');
				expect(tool.parameters).to.have.property('param1');
			});
		});

		describe('wrapToolExecution', () => {
			it('should wrap successful execution', async () => {
				const execute = async (params: Record<string, unknown>) => ({ value: params.input });
				const wrapped = wrapToolExecution(execute);

				const result = await wrapped({ input: 'test' });

				expect(result.success).to.be.true;
				expect(result.data).to.deep.equal({ value: 'test' });
				expect(result.executionTimeMs).to.be.a('number');
			});

			it('should wrap failed execution', async () => {
				const execute = async () => {
					throw new Error('Test error');
				};
				const wrapped = wrapToolExecution(execute);

				const result = await wrapped({});

				expect(result.success).to.be.false;
				expect(result.error).to.equal('Test error');
			});
		});

		describe('executeToolRequests', () => {
			it('should execute multiple tool requests', async () => {
				const tools: DebateTool[] = [
					createDebateTool({
						name: 'tool1',
						description: 'Tool 1',
						parameters: {},
						execute: async () => ({ success: true, data: 'result1' }),
					}),
					createDebateTool({
						name: 'tool2',
						description: 'Tool 2',
						parameters: {},
						execute: async () => ({ success: true, data: 'result2' }),
					}),
				];

				const requests = [
					{ toolName: 'tool1', parameters: {} },
					{ toolName: 'tool2', parameters: {} },
				];

				const results = await executeToolRequests(tools, requests, 'agent1');

				expect(results).to.have.length(2);
				expect(results[0].toolName).to.equal('tool1');
				expect(results[0].result.success).to.be.true;
				expect(results[1].toolName).to.equal('tool2');
				expect(results[1].result.success).to.be.true;
			});

			it('should handle unknown tool', async () => {
				const tools: DebateTool[] = [];
				const requests = [{ toolName: 'unknown', parameters: {} }];

				const results = await executeToolRequests(tools, requests, 'agent1');

				expect(results[0].result.success).to.be.false;
				expect(results[0].result.error).to.include('Unknown tool');
			});
		});

		describe('formatToolResultsForPrompt', () => {
			it('should format tool results as XML', () => {
				const toolCalls = [
					{
						toolName: 'Search_codebase',
						parameters: { pattern: 'test' },
						result: { success: true, data: 'found: file.ts' },
						timestamp: new Date(),
						agentId: 'agent1',
					},
				];

				const formatted = formatToolResultsForPrompt(toolCalls);

				expect(formatted).to.include('<tool_result name="Search_codebase" status="SUCCESS">');
				expect(formatted).to.include('found: file.ts');
			});

			it('should format error results', () => {
				const toolCalls = [
					{
						toolName: 'Read_file',
						parameters: { path: 'missing.ts' },
						result: { success: false, error: 'File not found' },
						timestamp: new Date(),
						agentId: 'agent1',
					},
				];

				const formatted = formatToolResultsForPrompt(toolCalls);

				expect(formatted).to.include('status="ERROR"');
				expect(formatted).to.include('File not found');
			});
		});

		describe('createDefaultDebateTools', () => {
			it('should create tools with mock executor', () => {
				const mockExecutor: IToolExecutor = {
					searchCodebase: async () => 'search results',
					readFile: async () => 'file contents',
					webSearch: async () => 'web results',
					webFetch: async () => 'fetched content',
				};

				const tools = createDefaultDebateTools(mockExecutor);

				expect(tools).to.have.length(4); // No vector search without vectorSearch method
				expect(tools.map((t) => t.name)).to.include.members(['Search_codebase', 'Read_file', 'WebSearch', 'WebFetch']);
			});
		});
	});

	// ========================================================================
	// debatePrompts.ts tests
	// ========================================================================

	describe('debatePrompts', () => {
		describe('extractJsonFromResponse', () => {
			it('should extract JSON from code block', () => {
				const response = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
				const result = extractJsonFromResponse<{ key: string }>(response);
				expect(result.key).to.equal('value');
			});

			it('should extract raw JSON', () => {
				const response = '{"key": "value"}';
				const result = extractJsonFromResponse<{ key: string }>(response);
				expect(result.key).to.equal('value');
			});

			it('should throw on invalid JSON', () => {
				expect(() => extractJsonFromResponse('not json')).to.throw();
			});
		});

		describe('parseConsensusResponse', () => {
			it('should parse CONSISTENT response', () => {
				const response = 'CONSISTENT\nAll agents agree on the main points';
				const result = parseConsensusResponse(response);

				expect(result.isConsistent).to.be.true;
				expect(result.explanation).to.equal('All agents agree on the main points');
			});

			it('should parse INCONSISTENT response', () => {
				const response = 'INCONSISTENT\nAgents disagree on key claims';
				const result = parseConsensusResponse(response);

				expect(result.isConsistent).to.be.false;
				expect(result.explanation).to.equal('Agents disagree on key claims');
			});
		});

		describe('formatCitations', () => {
			it('should format file citations with line numbers', () => {
				const citations: Citation[] = [
					{
						type: 'file',
						source: 'src/test.ts',
						excerpt: 'code snippet',
						lineNumbers: [10, 20],
					},
				];

				const formatted = formatCitations(citations);

				expect(formatted).to.include('[file] src/test.ts:10-20');
				expect(formatted).to.include('code snippet');
			});

			it('should format URL citations', () => {
				const citations: Citation[] = [
					{
						type: 'url',
						source: 'https://docs.example.com',
						excerpt: 'documentation quote',
					},
				];

				const formatted = formatCitations(citations);

				expect(formatted).to.include('[url] https://docs.example.com');
			});
		});

		describe('formatNeighborPositions', () => {
			it('should format neighbor positions', () => {
				const positions: DebatePosition[] = [
					{
						agentId: 'agent1',
						position: 'Position 1',
						confidence: 0.8,
						reasoning: 'Reasoning 1',
						citations: [],
						codeTraces: [],
						toolCalls: [],
					},
				];

				const formatted = formatNeighborPositions(positions);

				expect(formatted).to.include('agent="agent1"');
				expect(formatted).to.include('Position 1');
				expect(formatted).to.include('confidence="0.8"');
			});

			it('should handle empty positions', () => {
				const formatted = formatNeighborPositions([]);
				expect(formatted).to.include('No other positions');
			});
		});

		describe('buildInitialPositionPrompt', () => {
			it('should include topic and tools', () => {
				const context: DebateContext = {
					topic: 'Test topic',
					tools: [
						createDebateTool({
							name: 'TestTool',
							description: 'A test tool',
							parameters: {},
							execute: async () => ({ success: true }),
						}),
					],
					round: 0,
					previousRounds: [],
					sharedToolResults: [],
				};

				const prompt = buildInitialPositionPrompt('Test topic', context);

				expect(prompt).to.include('Test topic');
				expect(prompt).to.include('TestTool');
				expect(prompt).to.include('EVIDENCE REQUIREMENTS');
			});
		});
	});

	// ========================================================================
	// debaters tests
	// ========================================================================

	describe('debaters', () => {
		describe('LlmDebater', () => {
			it('should generate initial position', async () => {
				mockLLM.addResponse(`\`\`\`json
{
  "position": "Test position",
  "confidence": 0.8,
  "reasoning": "Test reasoning",
  "citations": [],
  "codeTraces": []
}
\`\`\``);

				const debater = new LlmDebater({
					id: 'test',
					name: 'Test Debater',
					llm: mockLLM,
				});

				const context: DebateContext = {
					topic: 'Test topic',
					tools: [],
					round: 0,
					previousRounds: [],
					sharedToolResults: [],
				};

				const response = await debater.generateInitialPosition('Test topic', context);

				expect(response.position).to.equal('Test position');
				expect(response.confidence).to.equal(0.8);
			});

			it('should handle malformed JSON response', async () => {
				mockLLM.addResponse('Not valid JSON, but position: My Position');

				const debater = new LlmDebater({
					id: 'test',
					name: 'Test Debater',
					llm: mockLLM,
				});

				const context: DebateContext = {
					topic: 'Test topic',
					tools: [],
					round: 0,
					previousRounds: [],
					sharedToolResults: [],
				};

				const response = await debater.generateInitialPosition('Test topic', context);

				// Should extract what it can
				expect(response.position).to.be.a('string');
				expect(response.confidence).to.equal(0.5); // Default fallback
			});
		});

		describe('createDebater', () => {
			it('should create LLM debater', () => {
				const debater = createDebater({
					id: 'test',
					name: 'Test',
					type: 'llm',
					llm: mockLLM,
				});

				expect(debater.id).to.equal('test');
				expect(debater.type).to.equal('llm');
			});

			it('should throw for LLM debater without llm', () => {
				expect(() =>
					createDebater({
						id: 'test',
						name: 'Test',
						type: 'llm',
					}),
				).to.throw('LLM debater requires an llm instance');
			});
		});

		describe('createDebaters', () => {
			it('should create multiple debaters', () => {
				const debaters = createDebaters([
					{ id: 'a', name: 'Agent A', type: 'llm', llm: mockLLM },
					{ id: 'b', name: 'Agent B', type: 'llm', llm: mockLLM },
				]);

				expect(debaters).to.have.length(2);
				expect(debaters[0].id).to.equal('a');
				expect(debaters[1].id).to.equal('b');
			});
		});
	});

	// ========================================================================
	// debateVerification.ts tests
	// ========================================================================

	describe('debateVerification', () => {
		describe('quickVerifyHasCitations', () => {
			it('should return true when all verified claims have citations', () => {
				const claims = [
					{ claim: 'Claim 1', status: 'verified' as const, citation: { type: 'file' as const, source: 'test.ts', excerpt: '...' } },
					{ claim: 'Claim 2', status: 'unverified' as const },
				];

				const result = quickVerifyHasCitations(claims);

				expect(result.allVerified).to.be.true;
				expect(result.unverifiedClaims).to.have.length(0);
			});

			it('should return false when verified claims lack citations', () => {
				const claims = [
					{ claim: 'Claim 1', status: 'verified' as const }, // No citation!
					{ claim: 'Claim 2', status: 'verified' as const, citation: { type: 'file' as const, source: 'test.ts', excerpt: '...' } },
				];

				const result = quickVerifyHasCitations(claims);

				expect(result.allVerified).to.be.false;
				expect(result.unverifiedClaims).to.include('Claim 1');
			});
		});

		describe('extractClaimsFromAnswer', () => {
			it('should extract claims using LLM', async () => {
				mockLLM.addResponse('```json\n["Claim 1", "Claim 2"]\n```');

				const claims = await extractClaimsFromAnswer('Answer with claims', mockLLM);

				expect(claims).to.deep.equal(['Claim 1', 'Claim 2']);
			});

			it('should fallback to sentence splitting on parse error', async () => {
				mockLLM.addResponse('Not valid JSON');

				const claims = await extractClaimsFromAnswer('This is a longer claim that should be extracted. And another one here as well!', mockLLM);

				expect(claims).to.be.an('array');
			});
		});

		describe('freshVerificationPass', () => {
			it('should verify claims with tool access', async () => {
				// First call: initial verification
				mockLLM.addResponse(`\`\`\`json
{
  "verifiedAnswer": "Verified answer",
  "claims": [
    { "claim": "Test claim", "status": "verified", "citation": { "type": "file", "source": "test.ts", "excerpt": "code" } }
  ],
  "corrections": [],
  "citations": []
}
\`\`\``);

				const synthesized: SynthesizedAnswer = {
					answer: 'Original answer',
					keyPoints: [],
					citations: [],
					confidence: 0.8,
				};

				const result = await freshVerificationPass('Test topic', synthesized, [], mockLLM);

				expect(result.originalAnswer).to.equal('Original answer');
				expect(result.verifiedAnswer).to.equal('Verified answer');
				expect(result.claims).to.have.length(1);
				expect(result.claims[0].status).to.equal('verified');
			});
		});
	});

	// ========================================================================
	// debateCoordinator.ts tests
	// ========================================================================

	describe('DebateCoordinator', () => {
		const createMockConfig = (): DebateConfig => ({
			maxRounds: 2,
			tools: [],
			consensusLLM: mockLLM,
			mediatorLLM: mockLLM,
			verificationLLM: mockLLM,
			hitlEnabled: false,
		});

		describe('getNeighborPositions (sparse topology)', () => {
			it('should return correct neighbors for circular topology', () => {
				// Create coordinator with 3 debaters
				const coordinator = new DebateCoordinator({
					topic: 'Test',
					debaters: [
						{ id: 'a', name: 'A', type: 'llm', llm: mockLLM },
						{ id: 'b', name: 'B', type: 'llm', llm: mockLLM },
						{ id: 'c', name: 'C', type: 'llm', llm: mockLLM },
					],
					config: createMockConfig(),
				});

				// Access private method for testing
				const getNeighbors = (coordinator as any).getNeighborPositions.bind(coordinator);

				const positions: DebatePosition[] = [
					{ agentId: 'a', position: 'A', confidence: 0.8, reasoning: '', citations: [], codeTraces: [], toolCalls: [] },
					{ agentId: 'b', position: 'B', confidence: 0.8, reasoning: '', citations: [], codeTraces: [], toolCalls: [] },
					{ agentId: 'c', position: 'C', confidence: 0.8, reasoning: '', citations: [], codeTraces: [], toolCalls: [] },
				];

				// Agent 0 should see agents 2 (left) and 1 (right)
				const neighbors0 = getNeighbors(positions, 0);
				expect(neighbors0.map((p: DebatePosition) => p.agentId)).to.deep.equal(['c', 'b']);

				// Agent 1 should see agents 0 (left) and 2 (right)
				const neighbors1 = getNeighbors(positions, 1);
				expect(neighbors1.map((p: DebatePosition) => p.agentId)).to.deep.equal(['a', 'c']);
			});
		});

		describe('consensus checking', () => {
			it('should detect consensus', async () => {
				mockLLM.addResponse('CONSISTENT\nAll agents agree');

				const coordinator = new DebateCoordinator({
					topic: 'Test',
					debaters: [{ id: 'a', name: 'A', type: 'llm', llm: mockLLM }],
					config: createMockConfig(),
				});

				const checkConsensus = (coordinator as any).checkConsensus.bind(coordinator);

				const positions: DebatePosition[] = [
					{ agentId: 'a', position: 'Position', confidence: 0.9, reasoning: '', citations: [], codeTraces: [], toolCalls: [] },
				];

				const result = await checkConsensus(positions);
				expect(result).to.be.true;
			});

			it('should detect lack of consensus', async () => {
				mockLLM.addResponse('INCONSISTENT\nAgents disagree');

				const coordinator = new DebateCoordinator({
					topic: 'Test',
					debaters: [{ id: 'a', name: 'A', type: 'llm', llm: mockLLM }],
					config: createMockConfig(),
				});

				const checkConsensus = (coordinator as any).checkConsensus.bind(coordinator);

				const positions: DebatePosition[] = [
					{ agentId: 'a', position: 'Position', confidence: 0.9, reasoning: '', citations: [], codeTraces: [], toolCalls: [] },
				];

				const result = await checkConsensus(positions);
				expect(result).to.be.false;
			});
		});

		describe('full debate flow', () => {
			it('should complete a simple debate with consensus', async () => {
				// Initial position response
				const positionResponse = `\`\`\`json
{
  "position": "Test position",
  "confidence": 0.9,
  "reasoning": "Test reasoning",
  "citations": [],
  "codeTraces": []
}
\`\`\``;

				// Queue responses for: 1 initial position, consensus check, synthesis, verification
				mockLLM
					.addResponse(positionResponse) // Initial position
					.addResponse('CONSISTENT\nAll agree') // Consensus check
					.addResponse(
						`\`\`\`json
{
  "answer": "Synthesized answer",
  "keyPoints": [],
  "citations": [],
  "confidence": 0.9
}
\`\`\``,
					) // Synthesis
					.addResponse(
						`\`\`\`json
{
  "verifiedAnswer": "Verified answer",
  "claims": [],
  "corrections": [],
  "citations": []
}
\`\`\``,
					); // Verification

				const result = await runDebate({
					topic: 'Test topic',
					debaters: [{ id: 'agent1', name: 'Agent 1', type: 'llm', llm: mockLLM }],
					config: {
						maxRounds: 2,
						tools: [],
						consensusLLM: mockLLM,
						mediatorLLM: mockLLM,
						verificationLLM: mockLLM,
						hitlEnabled: false,
					},
				});

				expect(result.debateId).to.be.a('string');
				expect(result.topic).to.equal('Test topic');
				expect(result.synthesizedAnswer.answer).to.equal('Synthesized answer');
				expect(result.verifiedAnswer.verifiedAnswer).to.equal('Verified answer');
				expect(result.consensusReached).to.be.true;
			});
		});

		describe('event emission', () => {
			it('should emit events during debate', async () => {
				const events: string[] = [];

				mockLLM
					.addResponse('{"position": "P", "confidence": 0.8, "reasoning": "R", "citations": [], "codeTraces": []}')
					.addResponse('CONSISTENT')
					.addResponse('{"answer": "A", "keyPoints": [], "citations": [], "confidence": 0.9}')
					.addResponse('{"verifiedAnswer": "V", "claims": [], "corrections": [], "citations": []}');

				await runDebate({
					topic: 'Test',
					debaters: [{ id: 'a', name: 'A', type: 'llm', llm: mockLLM }],
					config: {
						maxRounds: 1,
						tools: [],
						consensusLLM: mockLLM,
						mediatorLLM: mockLLM,
						verificationLLM: mockLLM,
						hitlEnabled: false,
					},
					onEvent: (event) => events.push(event.type),
				});

				expect(events).to.include('debate-started');
				expect(events).to.include('agent-thinking');
				expect(events).to.include('agent-position-complete');
				expect(events).to.include('synthesis-started');
				expect(events).to.include('verification-started');
				expect(events).to.include('debate-complete');
			});
		});
	});
});
