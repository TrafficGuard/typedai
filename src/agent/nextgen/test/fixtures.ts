/**
 * Test fixtures for NextGen agent testing
 */

import type { AgentLLMs, LlmFunctions } from '#shared/agent/agent.model';
import type { FunctionCallResult, LlmMessage } from '#shared/llm/llm.model';
import {
	type CacheOptimizedMessageStack,
	type CompactionConfig,
	DEFAULT_COMPACTION_CONFIG,
	type LiveFilesState,
	type NextGenAgentContext,
	type ToolLoadingState,
} from '../core/types';

/**
 * Creates a mock NextGenAgentContext for testing
 */
export function createMockAgentContext(overrides?: Partial<NextGenAgentContext>): NextGenAgentContext {
	const defaultMessageStack: CacheOptimizedMessageStack = {
		systemMessage: { role: 'system', content: 'You are a coding agent.', cache: 'ephemeral' },
		repositoryContext: { role: 'user', content: '<repository_overview>Test repo</repository_overview>', cache: 'ephemeral' },
		taskMessage: { role: 'user', content: '<task>Test task</task>', cache: 'ephemeral' },
		toolSchemas: [],
		recentHistory: [],
	};

	const defaultToolLoadingState: ToolLoadingState = {
		activeGroups: new Set(),
		groupsUsedSinceLastCompaction: new Set(),
		loadedAt: new Map(),
	};

	const defaultLiveFilesState: LiveFilesState = {
		files: new Map(),
		maxTokens: 5000,
		useDiffMarkers: true,
		useHashReferences: true,
	};

	const mockFunctions: LlmFunctions = {
		toJSON: () => ({ functionClasses: [] }),
		fromJSON: function () {
			return this;
		},
		removeFunctionClass: () => {},
		getFunctionInstances: () => [],
		getFunctionInstanceMap: () => ({}),
		getFunctionClassNames: () => [],
		getFunctionType: () => null,
		addFunctionInstance: () => {},
		addFunctionClass: () => {},
		callFunction: async () => null,
	};

	const mockLLM = {
		generateText: async () => '',
		generateMessage: async () => ({ role: 'assistant' as const, content: '' }),
		generateTextWithJson: async () => ({ message: { role: 'assistant' as const, content: '' }, reasoning: '', object: {} }),
		countTokens: async () => 0,
		getId: () => 'mock',
		getModel: () => 'mock',
		getService: () => 'mock',
		getMaxInputTokens: () => 100000,
	} as any;

	const mockLLMs: AgentLLMs = {
		easy: mockLLM,
		medium: mockLLM,
		hard: mockLLM,
		xhard: mockLLM,
	};

	return {
		agentId: 'test-agent-123',
		type: 'autonomous',
		subtype: 'nextgen',
		executionId: 'exec-123',
		typedAiRepoDir: '/test/repo',
		traceId: 'trace-123',
		name: 'Test Agent',
		user: { id: 'user-123', email: 'test@test.com' } as any,
		state: 'agent',
		callStack: [],
		hilBudget: 10,
		hilCount: 0,
		cost: 0,
		budgetRemaining: 10,
		llms: mockLLMs,
		fileSystem: null,
		useSharedRepos: true,
		memory: {},
		lastUpdate: Date.now(),
		createdAt: Date.now(),
		metadata: {},
		functions: mockFunctions,
		pendingMessages: [],
		iterations: 0,
		maxIterations: 50,
		invoking: [],
		notes: [],
		userPrompt: 'Test task',
		inputPrompt: 'Test task',

		// NextGen specific
		messageStack: defaultMessageStack,
		messages: [],
		compactionConfig: { ...DEFAULT_COMPACTION_CONFIG },
		lastCompactionIteration: 0,
		compactedSummaries: [],
		toolLoadingState: defaultToolLoadingState,
		liveFilesState: defaultLiveFilesState,
		activeSubAgents: new Map(),
		completedSubAgentResults: [],
		sessionLearnings: [],
		retrievedLearnings: [],
		structuredMemory: {},
		functionCallHistory: [],

		...overrides,
	} as NextGenAgentContext;
}

/**
 * Creates an agent context with a large function call history
 */
export function createAgentWithLargeContext(callCount = 50): NextGenAgentContext {
	const functionCallHistory: FunctionCallResult[] = Array(callCount)
		.fill(null)
		.map((_, i) => ({
			function_name: `TestFunction_${i}`,
			parameters: { input: 'x'.repeat(100) },
			stdout: 'y'.repeat(200),
		}));

	return createMockAgentContext({
		iterations: callCount,
		functionCallHistory,
	});
}

/**
 * Creates an agent context with a completed sub-task marker
 */
export function createAgentWithCompletedSubtask(): NextGenAgentContext {
	const recentHistory: LlmMessage[] = [
		{ role: 'assistant', content: '<plan>Implementing feature</plan>\n<code>print("done")</code>' },
		{ role: 'user', content: '<code_result>Success</code_result>' },
		{ role: 'assistant', content: '<subtask_complete>Feature implemented</subtask_complete>' },
	];

	return createMockAgentContext({
		iterations: 5,
		messageStack: {
			systemMessage: { role: 'system', content: 'System prompt', cache: 'ephemeral' },
			repositoryContext: { role: 'user', content: 'Repo overview', cache: 'ephemeral' },
			taskMessage: { role: 'user', content: 'Task', cache: 'ephemeral' },
			toolSchemas: [],
			recentHistory,
		},
	});
}

/**
 * Creates an agent context with loaded tool groups
 */
export function createAgentWithLoadedTools(groups: string[]): NextGenAgentContext {
	const toolLoadingState: ToolLoadingState = {
		activeGroups: new Set(groups),
		groupsUsedSinceLastCompaction: new Set(groups),
		loadedAt: new Map(groups.map((g) => [g, Date.now()])),
	};

	const toolSchemas: LlmMessage[] = groups.map((group) => ({
		role: 'user' as const,
		content: `<loaded_tool_group name="${group}">\n## ${group} Tools\n- function1\n- function2\n</loaded_tool_group>`,
	}));

	return createMockAgentContext({
		toolLoadingState,
		messageStack: {
			systemMessage: { role: 'system', content: 'System prompt', cache: 'ephemeral' },
			repositoryContext: { role: 'user', content: 'Repo overview', cache: 'ephemeral' },
			taskMessage: { role: 'user', content: 'Task', cache: 'ephemeral' },
			toolSchemas,
			recentHistory: [],
		},
	});
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Creates a plan response for mock LLM
 */
export function planResponse(plan: string): string {
	return `<agent:plan>${plan}</agent:plan>\n<code>pass</code>`;
}

/**
 * Creates a code response for mock LLM
 */
export function codeResponse(code: string): string {
	return `<agent:plan>Executing</agent:plan>\n<code>${code}</code>`;
}

/**
 * Creates a completion response for mock LLM
 */
export function completionResponse(result: string): string {
	return `<agent:plan>Done</agent:plan>\n<code>Agent_completed("${result}")</code>`;
}

/**
 * Creates a sub-task complete response
 */
export function subtaskCompleteResponse(summary: string): string {
	return `<agent:plan>Sub-task complete</agent:plan>\n<subtask_complete>${summary}</subtask_complete>`;
}

// ============================================================================
// Message Stack Helpers
// ============================================================================

/**
 * Builds a flat message array from a CacheOptimizedMessageStack
 */
export function buildMessagesFromStack(stack: CacheOptimizedMessageStack): LlmMessage[] {
	const messages: LlmMessage[] = [stack.systemMessage, stack.repositoryContext, stack.taskMessage];

	if (stack.compactedContext) {
		messages.push(stack.compactedContext);
	}

	messages.push(...stack.toolSchemas);
	messages.push(...stack.recentHistory);

	if (stack.currentIteration) {
		messages.push(stack.currentIteration);
	}

	return messages;
}

/**
 * Counts approximate tokens in messages (rough estimate: 4 chars = 1 token)
 */
export function estimateTokens(messages: LlmMessage[]): number {
	let chars = 0;
	for (const msg of messages) {
		if (typeof msg.content === 'string') {
			chars += msg.content.length;
		} else {
			for (const part of msg.content) {
				if ('text' in part) {
					chars += part.text.length;
				}
			}
		}
	}
	return Math.ceil(chars / 4);
}

/**
 * Creates a mock function call result
 */
export function createFunctionCallResult(name: string, output: string, params: Record<string, unknown> = {}): FunctionCallResult {
	return {
		function_name: name,
		parameters: params,
		stdout: output,
	};
}
