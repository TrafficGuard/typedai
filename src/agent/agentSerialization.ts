import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { ConsoleCompletedHandler } from '#agent/autonomous/agentCompletion';
import { getCompletedHandler } from '#agent/completionHandlerRegistry';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { deserializeLLMs } from '#llm/llmFactory';
import { logger } from '#o11y/logger';
import type { AgentCompleted, AgentContext, AgentLLMs, AgentRunningState, AgentType, AutonomousSubType } from '#shared/agent/agent.model';
import type { AgentContextApi } from '#shared/agent/agent.schema';
import type { FunctionCall, FunctionCallResult, LlmMessage } from '#shared/llm/llm.model';
import type { User } from '#shared/user/user.model';

export function serializeContext(context: AgentContext): AgentContextApi {
	// Ensure 'parameters' is present in invoking and functionCallHistory array items. (Possibly a Firestore issue)
	const serializedInvoking = (context.invoking ?? []).map((item) => ({
		...item,
		parameters: item.parameters ?? {},
	}));
	const serializedFunctionCallHistory = (context.functionCallHistory ?? []).map((item) => ({
		...item,
		parameters: item.parameters ?? {},
	}));

	return {
		agentId: context.agentId ?? 'unknown-agent-id-serialization-default',
		type: context.type ?? 'autonomous',
		subtype: context.subtype ?? 'xml',
		childAgents: context.childAgents ?? [],
		executionId: context.executionId ?? 'unknown-execution-id-default',
		typedAiRepoDir: context.typedAiRepoDir ?? (typeof process !== 'undefined' ? process.cwd() : 'unknown-repo-dir-default'),
		traceId: context.traceId ?? 'unknown-trace-id-default',
		containerId: context.containerId,
		name: context.name ?? 'Unnamed Agent (Default)',
		parentAgentId: context.parentAgentId,
		codeTaskId: context.codeTaskId,
		state: context.state ?? 'error',
		callStack: context.callStack ?? [],
		error: context.error || undefined,
		output: context.output,
		hilBudget: context.hilBudget ?? 0,
		cost: context.cost ?? 0,
		budgetRemaining: context.budgetRemaining ?? context.hilBudget ?? 0,
		lastUpdate: context.lastUpdate ?? Date.now(),
		createdAt: context.createdAt ?? Date.now(),
		metadata: context.metadata ?? {},
		iterations: context.iterations ?? 0,
		pendingMessages: context.pendingMessages ?? [],
		invoking: serializedInvoking,
		notes: context.notes ?? [],
		userPrompt: context.userPrompt ?? '',
		inputPrompt: context.inputPrompt ?? '',
		messages: context.messages ?? [],
		functionCallHistory: serializedFunctionCallHistory,
		hilCount: context.hilCount ?? 0,
		hilRequested: context.hilRequested ?? false,
		useSharedRepos: context.useSharedRepos ?? true,
		memory: context.memory ?? {},
		functions: context.functions ? context.functions.toJSON() : { functionClasses: [] },
		fileSystem: context.fileSystem ? context.fileSystem.toJSON() : null,
		user: context.user?.id ?? 'anonymous-serialized-id-missing',
		llms: context.llms
			? {
					easy: context.llms.easy?.getId() ?? 'unknown-llm-id-easy',
					medium: context.llms.medium?.getId() ?? 'unknown-llm-id-medium',
					hard: context.llms.hard?.getId() ?? 'unknown-llm-id-hard',
					xhard: context.llms.xhard?.getId(),
				}
			: {
					easy: 'default-llm-id-easy',
					medium: 'default-llm-id-medium',
					hard: 'default-llm-id-hard',
				},
		completedHandler: context.completedHandler ? context.completedHandler.agentCompletedHandlerId() : undefined,
		toolState: context.toolState ? JSON.parse(JSON.stringify(context.toolState)) : undefined,
	};
}

export function deserializeContext(data: AgentContextApi): AgentContext {
	const functionsImpl = new LlmFunctionsImpl().fromJSON(data.functions);
	const fileSystemImpl: FileSystemService | null = data.fileSystem ? new FileSystemService().fromJSON(data.fileSystem) : null;

	// Create a placeholder User object from the serialized ID.
	// In a real application, you might fetch the full User object asynchronously here.
	const userId = data.user; // data.user is the ID string from the schema
	const userName = userId === 'anonymous-serialized-id-missing' ? 'Anonymous Deserialized User (ID Missing)' : 'Deserialized User';
	const userEmail = userId === 'anonymous-serialized-id-missing' ? 'anon-deserialized-missing@example.com' : 'deserialized@example.com';

	const userImpl: User = {
		id: userId,
		name: userName,
		email: userEmail,
		enabled: userId !== 'anonymous-serialized-id-missing', // Assume enabled if ID is present
		createdAt: new Date(),
		lastLoginAt: undefined,
		hilBudget: data.hilBudget ?? 0,
		hilCount: data.hilCount ?? 0,
		llmConfig: {},
		chat: {},
		functionConfig: {},
	};

	const llmsImpl = deserializeLLMs(data.llms as Record<keyof AgentLLMs, string | undefined>);

	let completedHandlerImpl: AgentCompleted | undefined = undefined;
	// Use the new property name 'completedHandler'
	if (data.completedHandler) {
		completedHandlerImpl = getCompletedHandler(data.completedHandler);
		if (!completedHandlerImpl) {
			logger.warn(`Unknown completedHandler during deserialization: ${data.completedHandler}, defaulting to ConsoleCompletedHandler`);
			completedHandlerImpl = new ConsoleCompletedHandler();
		}
	} else {
		completedHandlerImpl = new ConsoleCompletedHandler(); // Default if no ID
	}

	const toolStateImpl = typeof data.toolState === 'string' ? JSON.parse(data.toolState) : (data.toolState ?? {});
	const functionCallHistoryImpl = (
		typeof data.functionCallHistory === 'string' ? JSON.parse(data.functionCallHistory) : (data.functionCallHistory ?? [])
	) as FunctionCallResult[];

	const agentContext: AgentContext = {
		agentId: data.agentId,
		type: data.type,
		subtype: data.subtype,
		childAgents: data.childAgents ?? [],
		executionId: data.executionId,
		containerId: data.containerId,
		typedAiRepoDir: data.typedAiRepoDir ?? process.cwd(),
		traceId: data.traceId ?? '',
		name: data.name,
		parentAgentId: data.parentAgentId,
		codeTaskId: data.codeTaskId,
		user: userImpl, // Assign the created User object
		state: data.state as AgentRunningState,
		callStack: data.callStack ?? [],
		error: typeof data.error === 'string' ? data.error : undefined,
		output: data.output,
		hilBudget: data.hilBudget ?? 2,
		cost: (Number.isNaN(data.cost) ? 0 : data.cost) ?? 0,
		budgetRemaining: data.budgetRemaining ?? data.hilBudget ?? 2,
		llms: llmsImpl,
		fileSystem: fileSystemImpl,
		useSharedRepos: data.useSharedRepos ?? true,
		memory: data.memory ?? {},
		lastUpdate: data.lastUpdate ?? Date.now(),
		createdAt: Number.isInteger(data.createdAt) ? data.createdAt : Date.now(),
		metadata: data.metadata ?? {},
		functions: functionsImpl,
		completedHandler: completedHandlerImpl,
		pendingMessages: data.pendingMessages ?? [],
		iterations: data.iterations ?? 0,
		invoking: (data.invoking as FunctionCall[]) ?? [],
		notes: data.notes ?? [],
		userPrompt: data.userPrompt,
		inputPrompt: data.inputPrompt ?? '',
		messages: (data.messages as LlmMessage[]) ?? [],
		functionCallHistory: functionCallHistoryImpl,
		hilCount: data.hilCount ?? 5,
		hilRequested: data.hilRequested ?? false,
		toolState: toolStateImpl,
	};
	return agentContext;
	/*
	}
	// handle array or string
	if (typeof serialized.functionCallHistory === 'string') context.functionCallHistory = JSON.parse(serialized.functionCallHistory);

	context.fileSystem = new FileSystemService().fromJSON(serialized.fileSystem);
	context.functions = new LlmFunctionsImpl().fromJSON(serialized.functions ?? (serialized as any).toolbox); // toolbox for backward compat
	context.memory = serialized.memory;
	context.metadata = serialized.metadata;
	context.fileStore = serialized.fileStore;
	context.childAgents = serialized.childAgents || [];
	context.llms = deserializeLLMs(serialized.llms);

	const user = currentUser();
	if (serialized.user === user.id) context.user = user;
	else context.user = await appContext().userService.getUser(serialized.user);

	const handlerId = serialized.completedHandler;
	if (handlerId) {
		context.completedHandler = getCompletedHandler(handlerId);
		if (!context.completedHandler)
			logger.error(`Completed handler with ID '${handlerId}' not found in registry during deserialization for agent ${serialized.agentId}.`);
	}

	// backwards compatability
	if (typeof serialized.toolState === 'string' && serialized.toolState.length) {
		context.toolState = JSON.parse(serialized.toolState);
	}

	context.toolState ??= {};
	// if (context.liveFiles?.length && !context.toolState.LiveFiles) context.toolState.LiveFiles = context.liveFiles;
	// if (context.fileStore?.length && !context.toolState.FileStore) context.toolState.FileStore = context.fileStore;

	if ((context.type as any) === 'codegen') {
		context.type = 'autonomous';
		context.subtype = 'codegen';
	}
	if (!context.type) context.type = 'autonomous';
	if ((context.type as any) === 'orchestrator') context.type = 'autonomous';
	if (context.type === 'autonomous' && !context.subtype) context.subtype = 'codegen';
	if (!context.iterations) context.iterations = 0;

	// Need to default empty parameters. Seems to get lost in Firestore
	context.functionCallHistory ??= [];
	for (const call of context.functionCallHistory) call.parameters ??= {};

	return context as AgentContext;
*/
}
