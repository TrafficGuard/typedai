import type { Static } from '@sinclair/typebox';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { ConsoleCompletedHandler } from '#agent/autonomous/agentCompletion';
import { getCompletedHandler } from '#agent/completionHandlerRegistry';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { deserializeLLMs } from '#llm/llmFactory';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import type { AgentCompleted, AgentContext, AgentLLMs, AgentRunningState, AgentType, AutonomousSubType } from '#shared/model/agent.model';
import type { FunctionCall, FunctionCallResult, LlmMessage } from '#shared/model/llm.model';
import type { User } from '#shared/model/user.model.ts';
import type { AgentContextApi, AgentContextSchema } from '#shared/schemas/agent.schema';
import type { IFileSystemService } from '#shared/services/fileSystemService';

export function serializeContext(context: AgentContext): AgentContextApi {
	context.llms ??= defaultLLMs();
	return {
		agentId: context.agentId,
		type: context.type,
		subtype: context.subtype,
		childAgents: context.childAgents ?? [],
		executionId: context.executionId,
		typedAiRepoDir: context.typedAiRepoDir,
		traceId: context.traceId,
		name: context.name,
		parentAgentId: context.parentAgentId,
		vibeSessionId: context.vibeSessionId,
		state: context.state,
		callStack: context.callStack ?? [],
		error: context.error,
		output: context.output,
		hilBudget: context.hilBudget,
		cost: context.cost,
		budgetRemaining: context.budgetRemaining,
		lastUpdate: context.lastUpdate,
		metadata: context.metadata ?? {},
		iterations: context.iterations,
		pendingMessages: context.pendingMessages ?? [],
		invoking: context.invoking ?? [],
		notes: context.notes ?? [],
		userPrompt: context.userPrompt,
		inputPrompt: context.inputPrompt ?? '',
		messages: context.messages ?? [],
		functionCallHistory: context.functionCallHistory ?? [],
		hilCount: context.hilCount,
		hilRequested: context.hilRequested ?? false,
		useSharedRepos: context.useSharedRepos ?? true,
		memory: context.memory ?? {},
		// Serialize complex objects into their JSON representation
		functions: context.functions ? context.functions.toJSON() : { functionClasses: [] },
		fileSystem: context.fileSystem ? context.fileSystem.toJSON() : null,
		// Serialize User object to just its ID
		user: context.user?.id ?? 'anonymous-serialized-id-missing',
		llms: {
			easy: context.llms.easy?.getId(),
			medium: context.llms.medium?.getId(),
			hard: context.llms.hard?.getId(),
			xhard: context.llms.xhard?.getId(),
		},
		// Use the new property name 'completedHandler'
		completedHandler: context.completedHandler ? context.completedHandler.agentCompletedHandlerId() : undefined,
		toolState: context.toolState ? JSON.parse(JSON.stringify(context.toolState)) : undefined,
	};
}

export function deserializeContext(data: Static<typeof AgentContextSchema>): AgentContext {
	const functionsImpl = new LlmFunctionsImpl().fromJSON(data.functions);
	const fileSystemImpl: IFileSystemService | null = data.fileSystem ? new FileSystemService().fromJSON(data.fileSystem) : null;

	// Create a placeholder User object from the serialized ID.
	// In a real application, you might fetch the full User object asynchronously here.
	const userId = data.user; // data.user is the ID string from the schema
	const userName = userId === 'anonymous-serialized-id-missing' ? 'Anonymous Deserialized User (ID Missing)' : 'Deserialized User';
	const userEmail = userId === 'anonymous-serialized-id-missing' ? 'anon-deserialized-missing@example.com' : 'deserialized@example.com';

	const userImpl: User = {
		id: userId,
		name: userName, // Placeholder
		email: userEmail, // Placeholder
		enabled: userId !== 'anonymous-serialized-id-missing', // Assume enabled if ID is present
		createdAt: new Date(), // Default
		lastLoginAt: undefined, // Default
		hilBudget: data.hilBudget ?? 0, // Default from schema or 0
		hilCount: data.hilCount ?? 0, // Default from schema or 0
		llmConfig: {}, // Default
		chat: {}, // Default
		functionConfig: {}, // Default
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

	return {
		agentId: data.agentId,
		type: data.type as AgentType,
		subtype: data.subtype as AutonomousSubType, // Assuming subtype from schema matches AutonomousSubType or is a string
		childAgents: data.childAgents ?? [],
		executionId: data.executionId,
		typedAiRepoDir: data.typedAiRepoDir ?? process.cwd(),
		traceId: data.traceId ?? '',
		name: data.name,
		parentAgentId: data.parentAgentId,
		vibeSessionId: data.vibeSessionId,
		user: userImpl, // Assign the created User object
		state: data.state as AgentRunningState,
		callStack: data.callStack ?? [],
		error: data.error,
		output: data.output,
		hilBudget: data.hilBudget ?? 2,
		cost: data.cost ?? 0,
		budgetRemaining: data.budgetRemaining ?? data.hilBudget ?? 2,
		llms: llmsImpl,
		fileSystem: fileSystemImpl,
		useSharedRepos: data.useSharedRepos ?? true,
		memory: data.memory ?? {},
		lastUpdate: data.lastUpdate ?? Date.now(),
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
