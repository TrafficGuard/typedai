import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { ConsoleCompletedHandler } from '#agent/autonomous/agentCompletion';
import type { RunAgentConfig, RunWorkflowConfig } from '#agent/autonomous/autonomousAgentRunner';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type { AgentContext, AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import { currentUser } from '#user/userContext';

export const agentContextStorage = new AsyncLocalStorage<AgentContext>();

export function agentContext(): AgentContext | undefined {
	return agentContextStorage?.getStore();
}

export function llms(): AgentLLMs {
	return agentContextStorage.getStore().llms;
}

/**
 * Adds costs to the current agent context (from LLM calls, Perplexity etc)
 * @param cost the cost spent in $USD
 */
export function addCost(cost: number) {
	const store = agentContextStorage.getStore();
	if (!store) return;
	logger.debug(`Adding cost $${cost.toFixed(6)}`);
	store.cost += cost;
	store.budgetRemaining -= cost;
}

/**
 * Adds a note for the agent, which will be included in the prompt for the agent after the tool results
 * @param note
 */
export function addNote(note: string): void {
	agentContext()?.notes.push(note);
}

/**
 * @return the filesystem on the current agent context
 */
export function getFileSystem(): IFileSystemService {
	if (!agentContextStorage.getStore()) return new FileSystemService();
	const filesystem = agentContextStorage.getStore()?.fileSystem;
	if (!filesystem) throw new Error('No file system available on the agent context');
	return filesystem;
}

export function createContext(config: RunAgentConfig | RunWorkflowConfig): AgentContext {
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
		metadata: config.metadata ?? {},
		name: config.agentName,
		type: (config as RunAgentConfig).type ?? 'workflow',
		subtype: config.subtype,
		user: config.user ?? currentUser(),
		inputPrompt: '',
		userPrompt: config.initialPrompt,
		state: 'agent',
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
		llms: config.llms, // we can't do `?? defaultLLMs()` as compiling breaks from import cycle dependencies,
		fileSystem,
		useSharedRepos: config.useSharedRepos ?? true, // Apply default if not provided in config
		functions: Array.isArray(config.functions) ? new LlmFunctionsImpl(...config.functions) : config.functions,
		completedHandler: config.completedHandler ?? new ConsoleCompletedHandler(),
		memory: {},
		invoking: [],
		lastUpdate: Date.now(),
		toolState: {},
		codeTaskId: config.codeTaskId,
	};
}
