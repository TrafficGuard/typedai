import chai, { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import type { AgentCompleted, AgentContext, AgentLLMs, LlmFunctions } from '#shared/agent/agent.model';
import type { AgentContextApi } from '#shared/agent/agent.schema'; // For context, not direct assertion
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { LLM } from '#shared/llm/llm.model';
import type { User } from '#shared/user/user.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { serializeContext } from './agentSerialization';

chai.use(sinonChai);

// Mock process.cwd for consistent testing of typedAiRepoDir
const mockCwd = '/mock/process/cwd';

// Mock Date.now for consistent testing of lastUpdate
const mockTimestamp = 1678886400000; // A fixed timestamp: 2023-03-15T12:00:00.000Z

describe('serializeContext', () => {
	setupConditionalLoggerOutput();
	let cwdStub: sinon.SinonStub;
	let dateNowStub: sinon.SinonStub;

	beforeEach(() => {
		cwdStub = sinon.stub(process, 'cwd').returns(mockCwd);
		dateNowStub = sinon.stub(Date, 'now').returns(mockTimestamp);
	});

	afterEach(() => {
		if (cwdStub) cwdStub.restore();
		if (dateNowStub) dateNowStub.restore();
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
		generateText: sinon.stub() as any,
		generateTextWithJson: sinon.stub() as any,
		generateJson: sinon.stub() as any,
		generateTextWithResult: sinon.stub() as any,
		generateMessage: sinon.stub() as any,
		streamText: sinon.stub() as any,
		getService: sinon.stub() as any,
		getModel: sinon.stub() as any,
		getDisplayName: sinon.stub() as any,
		getMaxInputTokens: sinon.stub() as any,
		countTokens: sinon.stub() as any,
		isConfigured: sinon.stub() as any,
		getOldModels: sinon.stub().returns([]),
	});

	// Minimal LlmFunctions mock
	const createMockLlmFunctions = (classes: string[] = []): LlmFunctions => ({
		toJSON: sinon.stub().returns({ functionClasses: classes }),
		fromJSON: sinon.stub(),
		removeFunctionClass: sinon.stub(),
		getFunctionInstances: sinon.stub(),
		getFunctionInstanceMap: sinon.stub(),
		getFunctionClassNames: sinon.stub(),
		getFunctionType: sinon.stub(),
		addFunctionInstance: sinon.stub(),
		addFunctionClass: sinon.stub(),
		callFunction: sinon.stub(),
	});

	// Minimal FileSystemService mock
	const createMockFileSystemService = (basePath = '/mock/base', workingDirectory = '/mock/wd'): IFileSystemService => ({
		toJSON: sinon.stub().returns({ basePath, workingDirectory }),
		fromJSON: sinon.stub(),
		readFile: sinon.stub(),
		readFileAsXML: sinon.stub(),
		writeFile: sinon.stub(),
		listFilesInDirectory: sinon.stub(),
		listFilesRecursively: sinon.stub(),
		listFilesRecurse: sinon.stub(),
		fileExists: sinon.stub(),
		directoryExists: sinon.stub(),
		getWorkingDirectory: sinon.stub(),
		setWorkingDirectory: sinon.stub(),
		getBasePath: sinon.stub(),
		searchFilesMatchingContents: sinon.stub(),
		searchExtractsMatchingContents: sinon.stub(),
		searchFilesMatchingName: sinon.stub(),
		getFileContentsRecursively: sinon.stub(),
		getFileContentsRecursivelyAsXml: sinon.stub(),
		readFiles: sinon.stub(),
		readFilesAsXml: sinon.stub(),
		formatFileContentsAsXml: sinon.stub(),
		writeNewFile: sinon.stub(),
		editFileContents: sinon.stub(),
		loadGitignoreRules: sinon.stub(),
		listFolders: sinon.stub(),
		getAllFoldersRecursively: sinon.stub(),
		getFileSystemTree: sinon.stub(),
		getFileSystemTreeStructure: sinon.stub(),
		getFileSystemNodes: sinon.stub(),
		buildNodeTreeRecursive: sinon.stub(),
		getVcs: sinon.stub(),
		getVcsRoot: sinon.stub(),
		deleteFile: sinon.stub(),
	});

	// Minimal AgentCompleted mock
	const createMockAgentCompleted = (id = 'mock-completed-handler'): AgentCompleted => ({
		agentCompletedHandlerId: sinon.stub().returns(id),
		notifyCompleted: sinon.stub(),
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

			expect(result.agentId).to.equal('test-agent-id');
			expect(result.user).to.equal(testUser.id);
			expect(result.llms).to.deep.equal({
				easy: 'easy-llm',
				medium: 'medium-llm',
				hard: 'hard-llm',
				xhard: undefined,
			});

			// Check defaults for other fields
			expect(result.type).to.equal('autonomous');
			expect(result.subtype).to.equal('xml');
			expect(result.childAgents).to.deep.equal([]);
			expect(result.executionId).to.equal('unknown-execution-id-default');
			expect(result.typedAiRepoDir).to.equal(mockCwd);
			expect(result.traceId).to.equal('unknown-trace-id-default');
			expect(result.name).to.equal('Unnamed Agent (Default)');
			expect(result.parentAgentId).to.be.undefined;
			expect(result.codeTaskId).to.be.undefined;
			expect(result.state).to.equal('error');
			expect(result.callStack).to.deep.equal([]);
			expect(result.error).to.be.undefined;
			expect(result.output).to.be.undefined;
			expect(result.hilBudget).to.equal(0);
			expect(result.cost).to.equal(0);
			expect(result.budgetRemaining).to.equal(0);
			expect(result.lastUpdate).to.equal(mockTimestamp);
			expect(result.metadata).to.deep.equal({});
			expect(result.iterations).to.equal(0);
			expect(result.pendingMessages).to.deep.equal([]);
			expect(result.invoking).to.deep.equal([]);
			expect(result.notes).to.deep.equal([]);
			expect(result.userPrompt).to.equal('');
			expect(result.inputPrompt).to.equal('');
			expect(result.messages).to.deep.equal([]);
			expect(result.functionCallHistory).to.deep.equal([]);
			expect(result.hilCount).to.equal(0);
			expect(result.hilRequested).to.be.false;
			expect(result.useSharedRepos).to.be.true;
			expect(result.memory).to.deep.equal({});
			expect(result.functions).to.deep.equal({ functionClasses: [] });
			expect(result.fileSystem).to.be.null;
			expect(result.completedHandler).to.be.undefined;
			expect(result.toolState).to.be.undefined;
		});
	});

	describe('Completely Empty Context Input', () => {
		it('should provide defaults for all fields when given a completely empty AgentContext', () => {
			const emptyContext = {} as any as AgentContext; // Use `as any` for test purposes
			const result = serializeContext(emptyContext);

			expect(result.agentId).to.equal('unknown-agent-id-serialization-default');
			expect(result.type).to.equal('autonomous');
			expect(result.subtype).to.equal('xml');
			expect(result.childAgents).to.deep.equal([]);
			expect(result.executionId).to.equal('unknown-execution-id-default');
			expect(result.typedAiRepoDir).to.equal(mockCwd);
			expect(result.traceId).to.equal('unknown-trace-id-default');
			expect(result.name).to.equal('Unnamed Agent (Default)');
			expect(result.parentAgentId).to.be.undefined;
			expect(result.codeTaskId).to.be.undefined;
			expect(result.user).to.equal('anonymous-serialized-id-missing');
			expect(result.state).to.equal('error');
			expect(result.callStack).to.deep.equal([]);
			expect(result.error).to.be.undefined;
			expect(result.output).to.be.undefined;
			expect(result.hilBudget).to.equal(0);
			expect(result.cost).to.equal(0);
			expect(result.budgetRemaining).to.equal(0);
			expect(result.llms).to.deep.equal({
				easy: 'default-llm-id-easy',
				medium: 'default-llm-id-medium',
				hard: 'default-llm-id-hard',
			});
			expect(result.fileSystem).to.be.null;
			expect(result.useSharedRepos).to.be.true;
			expect(result.memory).to.deep.equal({});
			expect(result.lastUpdate).to.equal(mockTimestamp);
			expect(result.metadata).to.deep.equal({});
			expect(result.functions).to.deep.equal({ functionClasses: [] });
			expect(result.completedHandler).to.be.undefined;
			expect(result.pendingMessages).to.deep.equal([]);
			expect(result.iterations).to.equal(0);
			expect(result.invoking).to.deep.equal([]);
			expect(result.notes).to.deep.equal([]);
			expect(result.userPrompt).to.equal('');
			expect(result.inputPrompt).to.equal('');
			expect(result.messages).to.deep.equal([]);
			expect(result.functionCallHistory).to.deep.equal([]);
			expect(result.hilCount).to.equal(0);
			expect(result.hilRequested).to.be.false;
			expect(result.toolState).to.be.undefined;
		});
	});

	describe('Specific Field Defaults', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-agent-specific-defaults' };

		it('should default agentId if undefined', () => {
			const context = { user: testUser } as any as AgentContext;
			expect(serializeContext(context).agentId).to.equal('unknown-agent-id-serialization-default');
		});

		it('should default type to "autonomous"', () => {
			const context = { ...baseContext, type: undefined } as AgentContext;
			expect(serializeContext(context).type).to.equal('autonomous');
		});

		it('should default subtype to "xml"', () => {
			const context = { ...baseContext, subtype: undefined } as AgentContext;
			expect(serializeContext(context).subtype).to.equal('xml');
		});

		it('should default executionId if undefined', () => {
			const context = { ...baseContext, executionId: undefined } as AgentContext;
			expect(serializeContext(context).executionId).to.equal('unknown-execution-id-default');
		});

		it('should default typedAiRepoDir if undefined', () => {
			const context = { ...baseContext, typedAiRepoDir: undefined } as AgentContext;
			expect(serializeContext(context).typedAiRepoDir).to.equal(mockCwd);
		});

		it('should default traceId if undefined', () => {
			const context = { ...baseContext, traceId: undefined } as AgentContext;
			expect(serializeContext(context).traceId).to.equal('unknown-trace-id-default');
		});

		it('should default name if undefined', () => {
			const context = { ...baseContext, name: undefined } as AgentContext;
			expect(serializeContext(context).name).to.equal('Unnamed Agent (Default)');
		});

		it('should default state if undefined', () => {
			const context = { ...baseContext, state: undefined } as AgentContext;
			expect(serializeContext(context).state).to.equal('error');
		});

		it('should default hilBudget if undefined', () => {
			const context = { ...baseContext, hilBudget: undefined } as AgentContext;
			expect(serializeContext(context).hilBudget).to.equal(0);
		});

		it('should default cost if undefined', () => {
			const context = { ...baseContext, cost: undefined } as AgentContext;
			expect(serializeContext(context).cost).to.equal(0);
		});

		it('should default budgetRemaining to 0 if undefined (and hilBudget defaults to 0)', () => {
			const context = { ...baseContext, budgetRemaining: undefined, hilBudget: undefined } as AgentContext;
			expect(serializeContext(context).budgetRemaining).to.equal(0);
		});

		it('should default budgetRemaining to hilBudget if budgetRemaining is undefined and hilBudget is set', () => {
			const context = { ...baseContext, budgetRemaining: undefined, hilBudget: 50 } as AgentContext;
			expect(serializeContext(context).budgetRemaining).to.equal(50);
		});

		it('should default lastUpdate if undefined', () => {
			const context = { ...baseContext, lastUpdate: undefined } as AgentContext;
			expect(serializeContext(context).lastUpdate).to.equal(mockTimestamp);
		});

		it('should default iterations if undefined', () => {
			const context = { ...baseContext, iterations: undefined } as AgentContext;
			expect(serializeContext(context).iterations).to.equal(0);
		});

		it('should default userPrompt if undefined', () => {
			const context = { ...baseContext, userPrompt: undefined } as AgentContext;
			expect(serializeContext(context).userPrompt).to.equal('');
		});

		it('should default inputPrompt if undefined', () => {
			const context = { ...baseContext, inputPrompt: undefined } as AgentContext;
			expect(serializeContext(context).inputPrompt).to.equal('');
		});

		it('should default hilCount if undefined', () => {
			const context = { ...baseContext, hilCount: undefined } as AgentContext;
			expect(serializeContext(context).hilCount).to.equal(0);
		});

		it('should default useSharedRepos if undefined', () => {
			const context = { ...baseContext, useSharedRepos: undefined } as AgentContext;
			expect(serializeContext(context).useSharedRepos).to.be.true;
		});

		it('should default hilRequested if undefined', () => {
			const context = { ...baseContext, hilRequested: undefined } as AgentContext;
			expect(serializeContext(context).hilRequested).to.be.false;
		});

		describe('LLMs Defaults', () => {
			it('should default llms to default IDs if context.llms is undefined', () => {
				const context = { ...baseContext, llms: undefined } as AgentContext;
				const result = serializeContext(context);
				expect(result.llms).to.deep.equal({
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
				expect(result.llms.easy).to.equal('unknown-llm-id-easy');
				expect(result.llms.medium).to.equal('m-id');
				expect(result.llms.hard).to.equal('h-id');
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
				expect(result.llms.medium).to.equal('unknown-llm-id-medium');
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
				expect(result.llms.hard).to.equal('unknown-llm-id-hard');
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
				expect(result.llms.xhard).to.equal('xh-id');
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
				expect(result.llms.xhard).to.be.undefined;
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
				expect(result[fieldName as keyof typeof result]).to.deep.equal(expectedValue);
			});
		});
	});

	describe('User Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-user-serialization' };
		it('should serialize user to user.id if user object is provided', () => {
			const context: Partial<AgentContext> = { ...baseContext, user: testUser };
			const result = serializeContext(context as AgentContext);
			expect(result.user).to.equal(testUser.id);
		});

		it('should serialize user to anonymous ID if user is undefined', () => {
			const context: Partial<AgentContext> = { ...baseContext, user: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.user).to.equal('anonymous-serialized-id-missing');
		});
	});

	describe('FileSystem Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-fs-serialization' };
		it('should serialize fileSystem using toJSON if fileSystem object is provided', () => {
			const mockFileSystem = createMockFileSystemService('/test-path', '/test-wd');
			const context: Partial<AgentContext> = { ...baseContext, fileSystem: mockFileSystem };
			const result = serializeContext(context as AgentContext);
			expect(result.fileSystem).to.deep.equal({ basePath: '/test-path', workingDirectory: '/test-wd' });
			expect(mockFileSystem.toJSON).to.have.been.calledOnce;
		});

		it('should serialize fileSystem to null if fileSystem is null in context', () => {
			const context: Partial<AgentContext> = { ...baseContext, fileSystem: null };
			const result = serializeContext(context as AgentContext);
			expect(result.fileSystem).to.be.null;
		});

		it('should serialize fileSystem to null if fileSystem is undefined in context', () => {
			const context: Partial<AgentContext> = { ...baseContext, fileSystem: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.fileSystem).to.be.null;
		});
	});

	describe('Functions Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-functions-serialization' };
		it('should serialize functions using toJSON if functions object is provided', () => {
			const mockFunctions = createMockLlmFunctions(['MyFunc']);
			const context: Partial<AgentContext> = { ...baseContext, functions: mockFunctions };
			const result = serializeContext(context as AgentContext);
			expect(result.functions).to.deep.equal({ functionClasses: ['MyFunc'] });
			expect(mockFunctions.toJSON).to.have.been.calledOnce;
		});

		it('should serialize functions to default { functionClasses: [] } if functions is undefined', () => {
			const context: Partial<AgentContext> = { ...baseContext, functions: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.functions).to.deep.equal({ functionClasses: [] });
		});
	});

	describe('CompletedHandler Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-handler-serialization' };
		it('should serialize completedHandler using agentCompletedHandlerId if provided', () => {
			const mockHandler = createMockAgentCompleted('handler-abc');
			const context: Partial<AgentContext> = { ...baseContext, completedHandler: mockHandler };
			const result = serializeContext(context as AgentContext);
			expect(result.completedHandler).to.equal('handler-abc');
			expect(mockHandler.agentCompletedHandlerId).to.have.been.calledOnce;
		});

		it('should serialize completedHandler to undefined if undefined', () => {
			const context: Partial<AgentContext> = { ...baseContext, completedHandler: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.completedHandler).to.be.undefined;
		});
	});

	describe('ToolState Serialization', () => {
		const baseContext: Partial<AgentContext> = { agentId: 'test-toolstate-serialization' };
		it('should serialize toolState by deep cloning if provided', () => {
			const originalToolState = { toolA: { data: 'value' }, toolB: [1, 2] };
			const context: Partial<AgentContext> = { ...baseContext, toolState: originalToolState };
			const result = serializeContext(context as AgentContext);
			expect(result.toolState).to.deep.equal(originalToolState);
			expect(result.toolState).to.not.equal(originalToolState);
			if (result.toolState && typeof result.toolState === 'object' && result.toolState.toolA) {
				expect(result.toolState.toolA as any).to.not.equal(originalToolState.toolA);
			}
		});

		it('should serialize toolState to undefined if undefined', () => {
			const context: Partial<AgentContext> = { ...baseContext, toolState: undefined };
			const result = serializeContext(context as AgentContext);
			expect(result.toolState).to.be.undefined;
		});
	});
});
