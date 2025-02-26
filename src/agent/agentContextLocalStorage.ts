import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { LlmFunctions } from '#agent/LlmFunctions';
import { ConsoleCompletedHandler } from '#agent/agentCompletion';
import { AgentContext, AgentLLMs } from '#agent/agentContextTypes';
import { RunAgentConfig, RunWorkflowConfig } from '#agent/agentRunner';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import { currentUser } from '#user/userService/userContext';

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
export function getFileSystem(): FileSystemService {
	if (!agentContextStorage.getStore()) return new FileSystemService();
	const filesystem = agentContextStorage.getStore()?.fileSystem;
	if (!filesystem) throw new Error('No file system available on the agent context');
	return filesystem;
}

export function createContext(config: RunAgentConfig | RunWorkflowConfig): AgentContext {
	const fileSystem = new FileSystemService(config.fileSystemPath);
	const hilBudget = config.humanInLoop?.budget ?? (process.env.HIL_BUDGET ? parseFloat(process.env.HIL_BUDGET) : 2);
	const context: AgentContext = {
		agentId: config.resumeAgentId || randomUUID(),
		parentAgentId: config.parentAgentId,
		executionId: randomUUID(),
		childAgents: [],
		traceId: '',
		metadata: config.metadata ?? {},
		name: config.agentName,
		type: config.type ?? 'codegen',
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
		hilCount: config.humanInLoop?.count ?? (process.env.HIL_COUNT ? parseFloat(process.env.HIL_COUNT) : 5),
		budgetRemaining: hilBudget,
		cost: 0,
		llms: config.llms, // we can't do `?? defaultLLMs()` as compiling breaks from import cycle dependencies,
		fileSystem,
		functions: Array.isArray(config.functions) ? new LlmFunctions(...config.functions) : config.functions,
		completedHandler: config.completedHandler ?? new ConsoleCompletedHandler(),
		memory: {},
		invoking: [],
		lastUpdate: Date.now(),
		liveFiles: [],
	};
	return context;
}
