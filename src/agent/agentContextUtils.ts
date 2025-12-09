import { randomUUID } from 'node:crypto';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { LoggerCompletedHandler } from '#agent/autonomous/agentCompletion';
import type { AgentContext, AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import { currentUser } from '#user/userContext';
import { agentContextStorage } from './agentContext';
import type { RunAgentConfig, RunWorkflowConfig } from './autonomous/runAgentTypes';

// Lazy load FileSystemService to avoid circular dependencies and minimize startup dependencies
let _FileSystemService: typeof import('#functions/storage/fileSystemService').FileSystemService | undefined;
function getFileSystemServiceClass(): typeof import('#functions/storage/fileSystemService').FileSystemService {
	_FileSystemService ??= require('#functions/storage/fileSystemService').FileSystemService;
	return _FileSystemService!;
}

let _fileSystemOverride: IFileSystemService | null = null;

export function setFileSystemOverride(fs: IFileSystemService | null): void {
	_fileSystemOverride = fs;
}

// Load async on load to avoid circular dependencies and keep the llms() function synchronous
let _defaultLLMs: AgentLLMs;

async function loadDefaultLLMS() {
	const { defaultLLMs } = await import('../llm/services/defaultLlmsModule.cjs');
	_defaultLLMs = defaultLLMs;
}
loadDefaultLLMS();

export function llms(): AgentLLMs {
	const store = agentContextStorage.getStore();
	return store?.llms ?? _defaultLLMs;
}

/**
 * @return the filesystem on the current agent context
 */
export function getFileSystem(): IFileSystemService {
	if (_fileSystemOverride) return _fileSystemOverride;
	if (!agentContextStorage.getStore()) {
		const FileSystemService = getFileSystemServiceClass();
		return new FileSystemService();
	}
	const filesystem = agentContextStorage.getStore()?.fileSystem;
	if (!filesystem) throw new Error('No file system available on the agent context');
	return filesystem;
}

export function createContext(config: RunAgentConfig | RunWorkflowConfig): AgentContext {
	const FileSystemService = getFileSystemServiceClass();
	const fileSystem = new FileSystemService(config.fileSystemPath);
	const hilBudget = config.humanInLoop?.budget ?? (process.env.HIL_BUDGET ? Number.parseFloat(process.env.HIL_BUDGET) : 2);
	const hilCount = config.humanInLoop?.count ?? (process.env.HIL_COUNT ? Number.parseFloat(process.env.HIL_COUNT) : 5);

	// type is optional on RunWorkflowConfig, which discriminates between RunAgentConfig and RunWorkflowConfig

	return {
		agentId: config.resumeAgentId || randomUUID(),
		parentAgentId: config.parentAgentId,
		executionId: randomUUID(),
		typedAiRepoDir: process.env.TYPEDAI_HOME || process.cwd(),
		childAgents: [],
		traceId: '',
		containerId: config.containerId,
		metadata: config.metadata ?? {},
		name: config.agentName,
		type: (config as RunAgentConfig).type ?? 'workflow',
		subtype: config.subtype,
		user: config.user ?? currentUser(),
		inputPrompt: '',
		userPrompt: config.initialPrompt,
		state: 'agent',
		error: undefined,
		iterations: 0,
		functionCallHistory: [],
		messages: [],
		pendingMessages: [],
		callStack: [],
		notes: [],
		hilBudget,
		hilCount,
		budgetRemaining: hilBudget,
		cost: 0,
		llms: config.llms ?? _defaultLLMs!,
		fileSystem,
		useSharedRepos: config.useSharedRepos ?? true, // Apply default if not provided in config
		functions: Array.isArray(config.functions) ? new LlmFunctionsImpl(...config.functions) : (config.functions ?? new LlmFunctionsImpl()),
		completedHandler: config.completedHandler ?? new LoggerCompletedHandler(),
		memory: config.initialMemory ?? {},
		invoking: [],
		lastUpdate: Date.now(),
		createdAt: Date.now(),
		toolState: {},
		codeTaskId: config.codeTaskId,
	};
}
