import type {
	AgentCompleted,
	AgentContext,
	AgentLLMs,
	IFileSystemService,
	LLM,
	LlmFunctions,
	User,
	// AgentType, // Not strictly needed for string literal checks
	// AutonomousSubType, // Not strictly needed for string literal checks
	// AgentRunningState, // Not strictly needed for string literal checks
} from '#shared/model/agent.model';
import type { AgentContextApi } from '#shared/schemas/agent.schema'; // For context, not direct assertion
import { serializeContext } from './agentSerialization';

// Mock process.cwd for consistent testing of typedAiRepoDir
const mockCwd = '/mock/process/cwd';
jest.spyOn(process, 'cwd').mockReturnValue(mockCwd);

// Mock Date.now for consistent testing of lastUpdate
const mockTimestamp = 1678886400000; // A fixed timestamp: 2023-03-15T12:00:00.000Z
let dateNowSpy: jest.SpyInstance;

describe('serializeContext', () => {
	beforeEach(() => {
		dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(mockTimestamp);
	});

	afterEach(() => {
		dateNowSpy.mockRestore();
	});

	// Minimal User for tests
	const testUser: User = {
		id: 'test-user-id',
		name: 'Test User',
		email: 'test@example.com',
		enabled: true,
		createdAt: new Date(mockTimestamp - 100000), // Ensure createdAt is distinct
		hilBudget: 0,
		hilCount: 0,
		llmConfig: {},
		chat: {},
		functionConfig: {},
	};

	// Minimal LLM mock
	const createMockLlm = (id: string): LLM => ({
		getId: () => id,
		// generate: jest.fn(), // Removed as 'generate' does not exist on LLM type as per TS2353
		// generateWithStreaming: jest.fn(), // Removed as it does not exist in LLM type
		// getFamily: jest.fn(), // Removed as it does not exist in LLM type
		// getVariant: jest.fn(), // Removed as it does not exist in LLM type
		// getCapabilities: jest.fn(), // Removed as it does not exist in LLM type
		// The LLM interface requires several methods. We'll mock the ones used by serialization or provide basic mocks.
		// For serialization, only getId() is directly used. Other methods can be basic jest.fn() if needed by other tests using this mock.
		generateText: jest.fn(),
		generateTextWithJson: jest.fn(),
		generateJson: jest.fn(),
		generateTextWithResult: jest.fn(),
		generateMessage: jest.fn(),
		streamText: jest.fn(),
		getService: jest.fn(),
		getModel: jest.fn(),
		getDisplayName: jest.fn(),
		getMaxInputTokens: jest.fn(),
		countTokens: jest.fn(),
		isConfigured: jest.fn(),
	});

	// Minimal LlmFunctions mock
	const createMockLlmFunctions = (classes: string[] = []): LlmFunctions => ({
		toJSON: jest.fn().mockReturnValue({ functionClasses: classes }),
		fromJSON: jest.fn(),
		removeFunctionClass: jest.fn(),
		getFunctionInstances: jest.fn(),
		getFunctionInstanceMap: jest.fn(),
		getFunctionClassNames: jest.fn(),
		getFunctionType: jest.fn(),
		addFunctionInstance: jest.fn(),
		addFunctionClass: jest.fn(),
		callFunction: jest.fn(),
	});

	// Minimal FileSystemService mock
	const createMockFileSystemService = (basePath = '/mock/base', workingDirectory = '/mock/wd'): IFileSystemService => ({
		toJSON: jest.fn().mockReturnValue({ basePath, workingDirectory }),
		fromJSON: jest.fn(),
		readFile: jest.fn(),
		readFileAsXML: jest.fn(), // Added missing method
		writeFile: jest.fn(),
		// deleteFile: jest.fn(), // Correctly removed as it does not exist in IFileSystemService type
		// listFiles: jest.fn(), // Removed, use listFilesInDirectory or listFilesRecursively
		listFilesInDirectory: jest.fn(), // Added to reflect interface
		listFilesRecursively: jest.fn(), // Added to reflect interface
		listFilesRecurse: jest.fn(), // Added to reflect interface
		// exists: jest.fn(), // Removed, use fileExists or directoryExists
		fileExists: jest.fn(), // Added to reflect interface
		directoryExists: jest.fn(), // Added to reflect interface
		// getRelativePath: jest.fn(), // Removed as it does not exist in IFileSystemService type
		// getAbsolutePath: jest.fn(), // Removed as it does not exist in IFileSystemService type
		// ensureDir: jest.fn(), // Removed as it does not exist in IFileSystemService type
		getWorkingDirectory: jest.fn(),
		setWorkingDirectory: jest.fn(),
		getBasePath: jest.fn(),
		// getFileSystemType: jest.fn(), // Removed as it does not exist in IFileSystemService type
		// watch: jest.fn(), // Removed as it does not exist in IFileSystemService type
		// disposeWatch: jest.fn(), // Removed as it does not exist in IFileSystemService type
		// searchFiles: jest.fn(), // Removed, use searchFilesMatchingContents or searchFilesMatchingName
		searchFilesMatchingContents: jest.fn(), // Added to reflect interface
		searchExtractsMatchingContents: jest.fn(), // Added to reflect interface
		searchFilesMatchingName: jest.fn(), // Added to reflect interface
		// rename: jest.fn(), // Removed as it does not exist in IFileSystemService type
		// copy: jest.fn(), // Removed as it does not exist in IFileSystemService type
		// getTempDir: jest.fn(), // Removed as it does not exist in IFileSystemService type
		getFileContentsRecursively: jest.fn(),
		getFileContentsRecursivelyAsXml: jest.fn(),
		readFiles: jest.fn(),
		readFilesAsXml: jest.fn(),
		formatFileContentsAsXml: jest.fn(),
		writeNewFile: jest.fn(),
		editFileContents: jest.fn(),
		loadGitignoreRules: jest.fn(),
		listFolders: jest.fn(),
		getAllFoldersRecursively: jest.fn(),
		getFileSystemTree: jest.fn(),
		getFileSystemTreeStructure: jest.fn(),
		getFileSystemNodes: jest.fn(),
		buildNodeTreeRecursive: jest.fn(),
		getVcs: jest.fn(),
		getVcsRoot: jest.fn(),
	});

	// Minimal AgentCompleted mock
	const createMockAgentCompleted = (id = 'mock-completed-handler'): AgentCompleted => ({
		agentCompletedHandlerId: jest.fn().mockReturnValue(id),
		notifyCompleted: jest.fn(),
	});

	describe('Minimal Context Input', () => {
		it('should provide defaults for most fields when given a minimally valid AgentContext', () => {
			const minimalContext: Partial<AgentContext> = {
				agentId: 'test-agent-id',
				user: testUser,
				llms: {
					easy: createMockLlm('easy-llm'),
					medium: createMockLlm('medium-llm'),
					hard: createMockLlm('hard-llm'),
				} as AgentLLMs,
			};

			const result = serializeContext(minimalContext as AgentContext);

			expect(result.agentId).toBe('test-agent-id');
			expect(result.user).toBe(testUser.id);
			expect(result.llms).toEqual({
				easy: 'easy-llm',
				medium: 'medium-llm',
				hard: 'hard-llm',
				xhard: undefined,
			});

			// Check defaults for other fields
			expect(result.type).toBe('autonomous');
			expect(result.subtype).toBe('xml');
			expect(result.childAgents).toEqual([]);
			expect(result.executionId).toBe('unknown-execution-id-default');
			expect(result.typedAiRepoDir).toBe(mockCwd);
			expect(result.traceId).toBe('unknown-trace-id-default');
			expect(result.name).toBe('Unnamed Agent (Default)');
			expect(result.parentAgentId).toBeUndefined();
			expect(result.codeTaskId).toBeUndefined();
			expect(result.state).toBe('error');
			expect(result.callStack).toEqual([]);
			expect(result.error).toBeUndefined();
			expect(result.output).toBeUndefined();
			expect(result.hilBudget).toBe(0);
			expect(result.cost).toBe(0);
			expect(result.budgetRemaining).toBe(0);
			expect(result.lastUpdate).toBe(mockTimestamp);
			expect(result.metadata).toEqual({});
			expect(result.iterations).toBe(0);
			expect(result.pendingMessages).toEqual([]);
			expect(result.invoking).toEqual([]);
			expect(result.notes).toEqual([]);
			expect(result.userPrompt).toBe('');
			expect(result.inputPrompt).toBe('');
			expect(result.messages).toEqual([]);
			expect(result.functionCallHistory).toEqual([]);
			expect(result.hilCount).toBe(0);
			expect(result.hilRequested).toBe(false);
			expect(result.useSharedRepos).toBe(true);
			expect(result.memory).toEqual({});
			expect(result.functions).toEqual({ functionClasses: [] });
			expect(result.fileSystem).toBeNull();
			expect(result.completedHandler).toBeUndefined();
			expect(result.toolState).toBeUndefined();
		});
	});

	describe('Completely Empty Context Input', () => {
		it('should provide defaults for all fields when given a completely empty AgentContext', () => {
			const emptyContext = {} as any as AgentContext; // Use `as any` for test purposes
			const result = serializeContext(emptyContext);

			expect(result.agentId).toBe('unknown-agent-id-serialization-default');
			expect(result.type).toBe('autonomous');
			expect(result.subtype).toBe('xml');
			expect(result.childAgents).toEqual([]);
			expect(result.executionId).toBe('unknown-execution-id-default');
			expect(result.typedAiRepoDir).toBe(mockCwd);
			expect(result.traceId).toBe('unknown-trace-id-default');
			expect(result.name).toBe('Unnamed Agent (Default)');
			expect(result.parentAgentId).toBeUndefined();
			expect(result.codeTaskId).toBeUndefined();
			expect(result.user).toBe('anonymous-serialized-id-missing');
			expect(result.state).toBe('error');
			expect(result.callStack).toEqual([]);
			expect(result.error).toBeUndefined();
			expect(result.output).toBeUndefined();
			expect(result.hilBudget).toBe(0);
			expect(result.cost).toBe(0);
			expect(result.budgetRemaining).toBe(0);
			expect(result.llms).toEqual({
				easy: 'default-llm-id-easy',
				medium: 'default-llm-id-medium',
				hard: 'default-llm-id-hard',
			});
			expect(result.fileSystem).toBeNull();
			expect(result.useSharedRepos).toBe(true);
			expect(result.memory).toEqual({});
			expect(result.lastUpdate).toBe(mockTimestamp);
			expect(result.metadata).toEqual({});
			expect(result.functions).toEqual({ functionClasses: [] });
			expect(result.completedHandler).toBeUndefined();
			expect(result.pendingMessages).toEqual([]);
			expect(result.iterations).toBe(0);
			expect(result.invoking).toEqual([]);
			expect(result.notes).toEqual([]);
			expect(result.userPrompt).toBe('');
			expect(result.inputPrompt).toBe('');
			expect(result.messages).toEqual([]);
			expect(result.functionCallHistory).toEqual([]);
			expect(result.hilCount).toBe(0);
			expect(result.hilRequested).toBe(false);
			expect(result.toolState).toBeUndefined();
		});
	});

	describe('Specific Field Defaults', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-agent-specific-defaults' };

		it('should default agentId if undefined', () => {
			const context = { user: testUser } as any as AgentContext;
			expect(serializeContext(context).agentId).toBe('unknown-agent-id-serialization-default');
		});

		it('should default type to "autonomous"', () => {
			const context = { ...baseContext, type: undefined } as AgentContext;
			expect(serializeContext(context).type).toBe('autonomous');
		});

		it('should default subtype to "xml"', () => {
			const context = { ...baseContext, subtype: undefined } as AgentContext;
			expect(serializeContext(context).subtype).toBe('xml');
		});

		it('should default executionId if undefined', () => {
			const context = { ...baseContext, executionId: undefined } as AgentContext;
			expect(serializeContext(context).executionId).toBe('unknown-execution-id-default');
		});

		it('should default typedAiRepoDir if undefined', () => {
			const context = { ...baseContext, typedAiRepoDir: undefined } as AgentContext;
			expect(serializeContext(context).typedAiRepoDir).toBe(mockCwd);
		});

		it('should default traceId if undefined', () => {
			const context = { ...baseContext, traceId: undefined } as AgentContext;
			expect(serializeContext(context).traceId).toBe('unknown-trace-id-default');
		});

		it('should default name if undefined', () => {
			const context = { ...baseContext, name: undefined } as AgentContext;
			expect(serializeContext(context).name).toBe('Unnamed Agent (Default)');
		});

		it('should default state if undefined', () => {
			const context = { ...baseContext, state: undefined } as AgentContext;
			expect(serializeContext(context).state).toBe('error');
		});

		it('should default hilBudget if undefined', () => {
			const context = { ...baseContext, hilBudget: undefined } as AgentContext;
			expect(serializeContext(context).hilBudget).toBe(0);
		});

		it('should default cost if undefined', () => {
			const context = { ...baseContext, cost: undefined } as AgentContext;
			expect(serializeContext(context).cost).toBe(0);
		});

		it('should default budgetRemaining to 0 if undefined (and hilBudget defaults to 0)', () => {
			const context = { ...baseContext, budgetRemaining: undefined, hilBudget: undefined } as AgentContext;
			expect(serializeContext(context).budgetRemaining).toBe(0);
		});

		it('should default budgetRemaining to hilBudget if budgetRemaining is undefined and hilBudget is set', () => {
			const context = { ...baseContext, budgetRemaining: undefined, hilBudget: 50 } as AgentContext;
			expect(serializeContext(context).budgetRemaining).toBe(50);
		});

		it('should default lastUpdate if undefined', () => {
			const context = { ...baseContext, lastUpdate: undefined } as AgentContext;
			expect(serializeContext(context).lastUpdate).toBe(mockTimestamp);
		});

		it('should default iterations if undefined', () => {
			const context = { ...baseContext, iterations: undefined } as AgentContext;
			expect(serializeContext(context).iterations).toBe(0);
		});

		it('should default userPrompt if undefined', () => {
			const context = { ...baseContext, userPrompt: undefined } as AgentContext;
			expect(serializeContext(context).userPrompt).toBe('');
		});

		it('should default inputPrompt if undefined', () => {
			const context = { ...baseContext, inputPrompt: undefined } as AgentContext;
			expect(serializeContext(context).inputPrompt).toBe('');
		});

		it('should default hilCount if undefined', () => {
			const context = { ...baseContext, hilCount: undefined } as AgentContext;
			expect(serializeContext(context).hilCount).toBe(0);
		});

		it('should default useSharedRepos if undefined', () => {
			const context = { ...baseContext, useSharedRepos: undefined } as AgentContext;
			expect(serializeContext(context).useSharedRepos).toBe(true);
		});

		it('should default hilRequested if undefined', () => {
			const context = { ...baseContext, hilRequested: undefined } as AgentContext;
			expect(serializeContext(context).hilRequested).toBe(false);
		});

		describe('LLMs Defaults', () => {
			it('should default llms to default IDs if context.llms is undefined', () => {
				const context = { ...baseContext, llms: undefined } as AgentContext;
				const result = serializeContext(context);
				expect(result.llms).toEqual({
					easy: 'default-llm-id-easy',
					medium: 'default-llm-id-medium',
					hard: 'default-llm-id-hard',
				});
			});

			it('should default llms.easy to unknown ID if context.llms.easy is undefined', () => {
				const context = {
					...baseContext,
					llms: {
						medium: createMockLlm('m-id'),
						hard: createMockLlm('h-id'),
					} as Partial<AgentLLMs>,
				} as AgentContext;
				const result = serializeContext(context);
				expect(result.llms.easy).toBe('unknown-llm-id-easy');
				expect(result.llms.medium).toBe('m-id');
				expect(result.llms.hard).toBe('h-id');
			});

			it('should default llms.medium to unknown ID if context.llms.medium is undefined', () => {
				const context = {
					...baseContext,
					llms: {
						easy: createMockLlm('e-id'),
						hard: createMockLlm('h-id'),
					} as Partial<AgentLLMs>,
				} as AgentContext;
				const result = serializeContext(context);
				expect(result.llms.medium).toBe('unknown-llm-id-medium');
			});

			it('should default llms.hard to unknown ID if context.llms.hard is undefined', () => {
				const context = {
					...baseContext,
					llms: {
						easy: createMockLlm('e-id'),
						medium: createMockLlm('m-id'),
					} as Partial<AgentLLMs>,
				} as AgentContext;
				const result = serializeContext(context);
				expect(result.llms.hard).toBe('unknown-llm-id-hard');
			});

			it('should pass through llms.xhard if defined', () => {
				const context = {
					...baseContext,
					llms: {
						easy: createMockLlm('e-id'),
						medium: createMockLlm('m-id'),
						hard: createMockLlm('h-id'),
						xhard: createMockLlm('xh-id'),
					} as AgentLLMs,
				} as AgentContext;
				const result = serializeContext(context);
				expect(result.llms.xhard).toBe('xh-id');
			});

			it('should set llms.xhard to undefined if not in source and context.llms exists', () => {
				const context = {
					...baseContext,
					llms: {
						easy: createMockLlm('e-id'),
						medium: createMockLlm('m-id'),
						hard: createMockLlm('h-id'),
					} as Partial<AgentLLMs>,
				} as AgentContext;
				const result = serializeContext(context);
				expect(result.llms.xhard).toBeUndefined();
			});
		});
	});

	describe('Fields Defaulting to Empty Collections or Objects', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-agent-collections' };

		const fieldsToTest: Array<{ fieldName: keyof AgentContextApi; expectedValue: any }> = [
			{ fieldName: 'childAgents', expectedValue: [] },
			{ fieldName: 'callStack', expectedValue: [] },
			{ fieldName: 'metadata', expectedValue: {} },
			{ fieldName: 'pendingMessages', expectedValue: [] },
			{ fieldName: 'invoking', expectedValue: [] },
			{ fieldName: 'notes', expectedValue: [] },
			{ fieldName: 'messages', expectedValue: [] },
			{ fieldName: 'functionCallHistory', expectedValue: [] },
			{ fieldName: 'memory', expectedValue: {} },
		];

		fieldsToTest.forEach(({ fieldName, expectedValue }) => {
			it(`should default ${fieldName} to ${JSON.stringify(expectedValue)} if undefined`, () => {
				const context = { ...baseContext, [fieldName]: undefined } as AgentContext;
				const result = serializeContext(context);
				expect(result[fieldName as keyof typeof result]).toEqual(expectedValue);
			});
		});
	});

	describe('User Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-user-serialization' };
		it('should serialize user to user.id if user object is provided', () => {
			const context: Partial<AgentContext> = { ...baseContext, user: testUser };
			const result = serializeContext(context as AgentContext);
			expect(result.user).toBe(testUser.id);
		});

		it('should serialize user to anonymous ID if user is undefined', () => {
			const context: Partial<AgentContext> = { ...baseContext, user: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.user).toBe('anonymous-serialized-id-missing');
		});
	});

	describe('FileSystem Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-fs-serialization' };
		it('should serialize fileSystem using toJSON if fileSystem object is provided', () => {
			const mockFileSystem = createMockFileSystemService('/test-path', '/test-wd');
			const context: Partial<AgentContext> = { ...baseContext, fileSystem: mockFileSystem };
			const result = serializeContext(context as AgentContext);
			expect(result.fileSystem).toEqual({ basePath: '/test-path', workingDirectory: '/test-wd' });
			expect(mockFileSystem.toJSON).toHaveBeenCalled();
		});

		it('should serialize fileSystem to null if fileSystem is null in context', () => {
			const context: Partial<AgentContext> = { ...baseContext, fileSystem: null };
			const result = serializeContext(context as AgentContext);
			expect(result.fileSystem).toBeNull();
		});

		it('should serialize fileSystem to null if fileSystem is undefined in context', () => {
			const context: Partial<AgentContext> = { ...baseContext, fileSystem: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.fileSystem).toBeNull();
		});
	});

	describe('Functions Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-functions-serialization' };
		it('should serialize functions using toJSON if functions object is provided', () => {
			const mockFunctions = createMockLlmFunctions(['MyFunc']);
			const context: Partial<AgentContext> = { ...baseContext, functions: mockFunctions };
			const result = serializeContext(context as AgentContext);
			expect(result.functions).toEqual({ functionClasses: ['MyFunc'] });
			expect(mockFunctions.toJSON).toHaveBeenCalled();
		});

		it('should serialize functions to default { functionClasses: [] } if functions is undefined', () => {
			const context: Partial<AgentContext> = { ...baseContext, functions: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.functions).toEqual({ functionClasses: [] });
		});
	});

	describe('CompletedHandler Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-handler-serialization' };
		it('should serialize completedHandler using agentCompletedHandlerId if provided', () => {
			const mockHandler = createMockAgentCompleted('handler-abc');
			const context: Partial<AgentContext> = { ...baseContext, completedHandler: mockHandler };
			const result = serializeContext(context as AgentContext);
			expect(result.completedHandler).toBe('handler-abc');
			expect(mockHandler.agentCompletedHandlerId).toHaveBeenCalled();
		});

		it('should serialize completedHandler to undefined if undefined', () => {
			const context: Partial<AgentContext> = { ...baseContext, completedHandler: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.completedHandler).toBeUndefined();
		});
	});

	describe('ToolState Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-toolstate-serialization' };
		it('should serialize toolState by deep cloning if provided', () => {
			const originalToolState = { toolA: { data: 'value' }, toolB: [1, 2] };
			const context: Partial<AgentContext> = { ...baseContext, toolState: originalToolState };
			const result = serializeContext(context as AgentContext);
			expect(result.toolState).toEqual(originalToolState);
			expect(result.toolState).not.toBe(originalToolState);
			if (result.toolState && typeof result.toolState === 'object' && result.toolState.toolA) {
				expect(result.toolState.toolA as any).not.toBe(originalToolState.toolA);
			}
		});

		it('should serialize toolState to undefined if undefined', () => {
			const context: Partial<AgentContext> = { ...baseContext, toolState: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.toolState).toBeUndefined();
		});
	});
});
