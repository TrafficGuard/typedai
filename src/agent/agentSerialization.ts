import type { Static } from '@sinclair/typebox';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { ConsoleCompletedHandler } from '#agent/autonomous/agentCompletion';
import { getCompletedHandler } from '#agent/completionHandlerRegistry';
import { appContext } from '#app/applicationContext';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { deserializeLLMs } from '#llm/llmFactory';
import { logger } from '#o11y/logger';
import type { AgentCompleted, AgentContext, AgentLLMs, AgentRunningState, AgentType, AutonomousSubType } from '#shared/model/agent.model';
import type { FunctionCall, FunctionCallResult, LLM, LlmMessage } from '#shared/model/llm.model';
import type { User } from '#shared/model/user.model.ts';
import type { AgentContextSchema } from '#shared/schemas/agent.schema';
import type { IFileSystemService } from '#shared/services/fileSystemService'; // Corrected import path
import { currentUser } from '#user/userContext';

export function serializeContext(context: AgentContext): Static<typeof AgentContextSchema> {
	const serializedData: any = {};

	serializedData.agentId = context.agentId;
	serializedData.type = context.type;
	serializedData.subtype = context.subtype;
	serializedData.childAgents = context.childAgents ?? [];
	serializedData.executionId = context.executionId;
	serializedData.typedAiRepoDir = context.typedAiRepoDir;
	serializedData.traceId = context.traceId;
	serializedData.name = context.name;
	serializedData.parentAgentId = context.parentAgentId;
	serializedData.vibeSessionId = context.vibeSessionId;
	serializedData.state = context.state;
	serializedData.callStack = context.callStack ?? [];
	serializedData.error = context.error;
	serializedData.output = context.output;
	serializedData.hilBudget = context.hilBudget;
	serializedData.cost = context.cost;
	serializedData.budgetRemaining = context.budgetRemaining;
	serializedData.lastUpdate = context.lastUpdate;
	serializedData.metadata = context.metadata ?? {};
	serializedData.iterations = context.iterations;
	serializedData.pendingMessages = context.pendingMessages ?? [];
	serializedData.invoking = context.invoking ?? [];
	serializedData.notes = context.notes ?? [];
	serializedData.userPrompt = context.userPrompt;
	serializedData.inputPrompt = context.inputPrompt ?? '';
	serializedData.messages = context.messages ?? [];
	serializedData.functionCallHistory = context.functionCallHistory ?? [];
	serializedData.hilCount = context.hilCount;
	serializedData.hilRequested = context.hilRequested ?? false;
	serializedData.liveFiles = context.liveFiles ?? [];
	serializedData.fileStore = context.fileStore ?? [];
	serializedData.useSharedRepos = context.useSharedRepos ?? true;
	serializedData.memory = context.memory ?? {};

	serializedData.functions = context.functions ? context.functions.toJSON() : { functionClasses: [] };
	serializedData.fileSystem = context.fileSystem ? context.fileSystem.toJSON() : undefined;
	serializedData.user = context.user ? context.user.id : undefined;

	serializedData.llms = {};
	if (context.llms?.easy) serializedData.llms.easy = context.llms.easy.getId();
	if (context.llms?.medium) serializedData.llms.medium = context.llms.medium.getId();
	if (context.llms?.hard) serializedData.llms.hard = context.llms.hard.getId();
	if (context.llms?.xhard) serializedData.llms.xhard = context.llms.xhard.getId();

	serializedData.completedHandlerId = context.completedHandler ? context.completedHandler.agentCompletedHandlerId() : undefined;
	serializedData.toolState = context.toolState ? JSON.parse(JSON.stringify(context.toolState)) : undefined;

	return serializedData as Static<typeof AgentContextSchema>;
}

export function deserializeContext(data: Static<typeof AgentContextSchema>): AgentContext {
	const functionsImpl = new LlmFunctionsImpl().fromJSON(data.functions);
	const fileSystemImpl: IFileSystemService | null = data.fileSystem ? new FileSystemService().fromJSON(data.fileSystem) : null;

	// Create a placeholder User object. For a full User object, async fetching would be needed.
	// data.user is expected to be the user ID string.
	const userId = typeof data.user === 'string' ? data.user : 'anonymous-deserialized-id-missing';
	const userName = userId === 'anonymous-deserialized-id-missing' ? 'Anonymous Deserialized User (ID Missing)' : 'Deserialized User';
	const userEmail = userId === 'anonymous-deserialized-id-missing' ? 'anon-deserialized-missing@example.com' : 'deserialized@example.com';

	const userImpl: User = {
		id: userId,
		name: userName, // Placeholder
		email: userEmail, // Placeholder
		enabled: !!data.user, // true if user ID was present, false otherwise
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
	if (data.completedHandlerId) { // Use completedHandlerId from schema
		completedHandlerImpl = getCompletedHandler(data.completedHandlerId);
		if (!completedHandlerImpl) {
			logger.warn(`Unknown completedHandlerId during deserialization: ${data.completedHandlerId}, defaulting to ConsoleCompletedHandler`);
			completedHandlerImpl = new ConsoleCompletedHandler();
		}
	} else {
		completedHandlerImpl = new ConsoleCompletedHandler(); // Default if no ID
	}

	const toolStateImpl = typeof data.toolState === 'string' ? JSON.parse(data.toolState) : (data.toolState ?? {});
	const functionCallHistoryImpl = (
		typeof data.functionCallHistory === 'string' ? JSON.parse(data.functionCallHistory) : (data.functionCallHistory ?? [])
	) as FunctionCallResult[];

	const context: AgentContext = {
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
		user: userImpl,
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
		liveFiles: data.liveFiles ?? [],
		fileStore: data.fileStore ?? [], // Assuming FileMetadata[] if data.fileStore is Type.Any()
		toolState: toolStateImpl,
	};
	return context;
}
