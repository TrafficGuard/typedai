import type { Static } from '@sinclair/typebox';
import type { Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';
import { sql } from 'kysely';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import { deserializeContext, serializeContext } from '#agent/agentSerialization';
import { functionFactory } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import {
	type AgentContext,
	type AgentContextPreview,
	type AgentRunningState,
	type AgentType,
	type AutonomousIteration,
	type AutonomousIterationSummary,
	isExecuting,
} from '#shared/agent/agent.model';
import type { AgentContextSchema } from '#shared/agent/agent.schema';
import { NotAllowed, NotFound } from '#shared/errors';
import type { FunctionCallResult, GenerationStats, ImagePartExt } from '#shared/llm/llm.model';
import type { User } from '#shared/user/user.model';
import { currentUser } from '#user/userContext';
import type { AgentContextsTable, AgentIterationsTable, Database } from './db';
import { db as defaultDb } from './db';

// Type alias for the return type of _serializeContextForDb
type SerializedAgentContextData = Omit<Insertable<AgentContextsTable>, 'agent_id' | 'created_at' | 'last_update'>;
// Type alias for the return type of _serializeIterationForDb
type SerializedAgentIterationData = Omit<Insertable<AgentIterationsTable>, 'agent_id' | 'iteration_number' | 'created_at'>;

export class PostgresAgentStateService implements AgentContextService {
	private db: Kysely<Database>;

	constructor(dbInstance?: Kysely<Database>) {
		this.db = dbInstance || defaultDb;
	}

	private _serializeContextForDb(context: AgentContext): SerializedAgentContextData {
		const serialized = serializeContext(context);
		return {
			execution_id: serialized.executionId,
			container_id: serialized.containerId,
			typed_ai_repo_dir: serialized.typedAiRepoDir,
			trace_id: serialized.traceId,
			name: serialized.name,
			parent_agent_id: serialized.parentAgentId,
			user_id: context.user.id, // Ensure this uses the user's ID
			state: serialized.state,
			call_stack: serialized.callStack ? JSON.stringify(serialized.callStack) : null,
			error: serialized.error,
			hil_budget: serialized.hilBudget,
			hil_count: serialized.hilCount,
			cost: serialized.cost,
			budget_remaining: serialized.budgetRemaining,
			llms_serialized: JSON.stringify(serialized.llms),
			use_shared_repos: serialized.useSharedRepos,
			memory_serialized: JSON.stringify(serialized.memory),
			metadata_serialized: serialized.metadata ? JSON.stringify(serialized.metadata) : null,
			functions_serialized: JSON.stringify(serialized.functions),
			completed_handler_id: serialized.completedHandler as string | null,
			pending_messages_serialized: serialized.pendingMessages ? JSON.stringify(serialized.pendingMessages) : null,
			type: serialized.type,
			subtype: serialized.subtype,
			iterations: serialized.iterations,
			invoking_serialized: serialized.invoking ? JSON.stringify(serialized.invoking) : null,
			notes_serialized: serialized.notes ? JSON.stringify(serialized.notes) : null,
			user_prompt: serialized.userPrompt,
			input_prompt: serialized.inputPrompt,
			messages_serialized: JSON.stringify(serialized.messages),
			function_call_history_serialized: serialized.functionCallHistory ? JSON.stringify(serialized.functionCallHistory) : null,
			child_agents_ids: serialized.childAgents ? JSON.stringify(serialized.childAgents) : null,
			hil_requested: serialized.hilRequested,
		};
	}

	/**
	 * Safely parses a JSON string or uses a pre-parsed object.
	 * Returns null on actual parsing error, null/undefined input, empty string, or unexpected primitive type.
	 * Logs warnings/errors for issues.
	 * @param jsonString The string or object to parse/use.
	 * @param fieldName The name of the field being parsed (for logging).
	 * @returns The parsed object (T) or null.
	 */
	private safeJsonParse<T>(jsonString: string | object | null | undefined, fieldName: string): T | null {
		if (jsonString === null || jsonString === undefined) {
			// logger.debug(`safeJsonParse: field ${fieldName} was null or undefined, returning null.`); // Optional debug log
			return null;
		}

		try {
			if (typeof jsonString === 'string') {
				const trimmed = jsonString.trim();
				// Prevent parsing empty string as JSON, which would error.
				// An empty string is not valid JSON.
				if (trimmed === '') {
					// logger.debug(`safeJsonParse: field ${fieldName} was an empty string, returning null.`); // Optional debug log
					return null;
				}
				return JSON.parse(trimmed) as T;
			}
			// If jsonString is not a string, but is an object (and not null, which is handled by the initial check),
			// it's assumed to be pre-parsed by the database driver (e.g., for jsonb columns).
			if (typeof jsonString === 'object') {
				return jsonString as T;
			}
			// If jsonString has passed the initial '!jsonString' check, and is not a string,
			// and not an object, then it's an unexpected primitive type (e.g., number, boolean)
			// for a field that's supposed to contain JSON.
			logger.warn(`safeJsonParse received unexpected primitive type for field ${fieldName}: ${typeof jsonString}. Value: ${String(jsonString)}`);
			return null;
		} catch (error) {
			// Log the original value carefully, as stringifying an object might also fail or be too verbose.
			let valueToLog: string;
			if (typeof jsonString === 'string') {
				valueToLog = jsonString;
			} else {
				try {
					// For objects, attempt to stringify, but keep it concise.
					valueToLog = JSON.stringify(jsonString)?.substring(0, 200) + (JSON.stringify(jsonString)?.length > 200 ? '...' : '');
				} catch (e) {
					valueToLog = `[Unserializable Object of type ${typeof jsonString}]`;
				}
			}
			logger.warn(
				`Failed to parse or handle JSON for field '${fieldName}'. Value snippet: '${valueToLog}'. Error: ${error instanceof Error ? error.message : String(error)}`,
			);
			return null;
		}
	}

	private async _deserializeDbRowToAgentContext(row: Selectable<AgentContextsTable>): Promise<AgentContext> {
		// Ensure logger is imported: import { logger } from '#o11y/logger';
		let resolvedUserId: string;
		// Cast row.user_id to 'any' for this specific multi-type check to avoid 'never' type issues
		// if the database schema (string) and runtime data (object) mismatch.
		const userIdFromDb = row.user_id as any;

		if (userIdFromDb === null || userIdFromDb === undefined) {
			logger.error(
				`_deserializeDbRowToAgentContext: user_id from database is null or undefined for agent_id: ${row.agent_id}. This violates schema constraints.`,
			);
			throw new Error(`User ID is unexpectedly null or undefined for agent_id: ${row.agent_id}.`);
		}
		if (typeof userIdFromDb === 'object') {
			// Ensure userIdFromDb is not null before accessing 'id', though the first check covers null.
			// Also check if 'id' property exists and is not null/undefined.
			if (userIdFromDb && 'id' in userIdFromDb && userIdFromDb.id !== null && userIdFromDb.id !== undefined) {
				resolvedUserId = String(userIdFromDb.id);
			} else {
				logger.error(
					`_deserializeDbRowToAgentContext: user_id is an object but lacks a valid 'id' property for agent_id: ${row.agent_id}. Value: ${JSON.stringify(userIdFromDb)}`,
				);
				throw new Error(`User ID is an object for agent_id ${row.agent_id} but lacks a valid 'id' property.`);
			}
		} else {
			resolvedUserId = String(userIdFromDb);
		}
		// const userForDeserialization = currentUser().id === resolvedUserId ? currentUser() : ({ id: resolvedUserId } as User); // Not needed with AgentContextSchema

		const dataForDeserialization: Static<typeof AgentContextSchema> = {
			agentId: row.agent_id,
			executionId: row.execution_id,
			containerId: row.container_id ?? undefined,
			typedAiRepoDir: row.typed_ai_repo_dir,
			traceId: row.trace_id,
			name: row.name ?? '',
			parentAgentId: row.parent_agent_id ?? undefined,
			user: resolvedUserId, // CRITICAL: This must be the string user ID
			state: row.state as AgentRunningState, // Assuming AgentRunningState is compatible
			callStack: this.safeJsonParse(row.call_stack, 'call_stack_schema_align') ?? [],
			error: row.error === null ? undefined : row.error,
			hilBudget: row.hil_budget !== null && row.hil_budget !== undefined ? Number.parseFloat(String(row.hil_budget)) : 2,
			hilCount: row.hil_count ?? 20,
			cost: row.cost !== null && row.cost !== undefined ? Number.parseFloat(String(row.cost)) : 0, // Default in schema if not present
			budgetRemaining: row.budget_remaining ? Number.parseFloat(String(row.budget_remaining)) : 0,
			llms: this.safeJsonParse(row.llms_serialized, 'llms_serialized_schema_align') ?? { easy: '', medium: '', hard: '', xhard: '' },
			useSharedRepos: row.use_shared_repos ?? false,
			memory: this.safeJsonParse(row.memory_serialized, 'memory_serialized_schema_align') ?? {}, // Default in schema
			lastUpdate: (row.last_update as Date).getTime(), // Schema expects number (timestamp)
			metadata: this.safeJsonParse(row.metadata_serialized, 'metadata_serialized_schema_align') ?? {}, // Default in schema
			functions: this.safeJsonParse(row.functions_serialized, 'functions_serialized_schema_align') ?? { functionClasses: [] },
			completedHandler: row.completed_handler_id === null ? undefined : row.completed_handler_id,
			pendingMessages: this.safeJsonParse(row.pending_messages_serialized, 'pending_messages_serialized_schema_align') ?? [],
			type: row.type as AgentType, // Assuming AgentType is compatible
			subtype: row.subtype ?? '',
			iterations: row.iterations, // Schema expects number
			invoking: this.safeJsonParse(row.invoking_serialized, 'invoking_serialized_schema_align') ?? [],
			notes: this.safeJsonParse(row.notes_serialized, 'notes_serialized_schema_align') ?? [],
			userPrompt: row.user_prompt ?? '',
			inputPrompt: row.input_prompt, // Schema expects string, DB schema for input_prompt is NOT NULL.
			messages: this.safeJsonParse(row.messages_serialized, 'messages_serialized_schema_align') ?? [],
			functionCallHistory: this.safeJsonParse(row.function_call_history_serialized, 'function_call_history_serialized_schema_align') ?? [],
			childAgents: this.safeJsonParse(row.child_agents_ids, 'child_agents_ids_schema_align') ?? [],
			hilRequested: row.hil_requested === null ? undefined : row.hil_requested,

			// Ensure all fields from AgentContextSchema are present, using undefined for those not in AgentContextsTable
			// or not yet handled. deserializeContext should have defaults for these.
			fileSystem: null, // deserializeContext handles default for complex objects if schema allows undefined
			toolState: undefined,
			createdAt: row.created_at ? (row.created_at as Date).getTime() : Date.now(), // Safely handle optional field
		};
		return deserializeContext(dataForDeserialization);
	}

	private _serializeIterationForDb(iteration: AutonomousIteration): SerializedAgentIterationData {
		return {
			functions_serialized: iteration.functions ? JSON.stringify(iteration.functions) : null,
			prompt: iteration.prompt,
			response: iteration.response,
			summary: iteration.summary,
			expanded_user_request: iteration.expandedUserRequest,
			observations_reasoning: iteration.observationsReasoning,
			agent_plan: iteration.agentPlan,
			next_step_details: iteration.nextStepDetails,
			code: iteration.code,
			executed_code: iteration.executedCode,
			draft_code: iteration.draftCode,
			code_review: iteration.codeReview,
			images_serialized: iteration.images ? JSON.stringify(iteration.images) : null,
			function_calls_serialized: iteration.functionCalls ? JSON.stringify(iteration.functionCalls) : null,
			memory_serialized: iteration.memory ? JSON.stringify(iteration.memory instanceof Map ? Object.fromEntries(iteration.memory) : iteration.memory) : null,
			tool_state_serialized: iteration.toolState
				? JSON.stringify(iteration.toolState instanceof Map ? Object.fromEntries(iteration.toolState) : iteration.toolState)
				: null,
			error: iteration.error,
			stats_serialized: iteration.stats ? JSON.stringify(iteration.stats) : null,
			cost: iteration.cost,
		};
	}

	private _deserializeDbRowToIteration(row: Selectable<AgentIterationsTable>): AutonomousIteration {
		const parsedFunctions = this.safeJsonParse<string[]>(row.functions_serialized, 'functions_serialized_iteration');
		const parsedImages = this.safeJsonParse<ImagePartExt[]>(row.images_serialized, 'images_serialized_iteration');
		const parsedFunctionCalls = this.safeJsonParse<FunctionCallResult[]>(row.function_calls_serialized, 'function_calls_serialized_iteration');
		const parsedMemory = this.safeJsonParse<Record<string, string>>(row.memory_serialized, 'memory_serialized_iteration');
		const parsedToolState = this.safeJsonParse<Record<string, any>>(row.tool_state_serialized, 'tool_state_serialized_iteration');
		const parsedStats = this.safeJsonParse<GenerationStats>(row.stats_serialized, 'stats_serialized_iteration');

		return {
			agentId: row.agent_id,
			iteration: row.iteration_number,
			createdAt: (row.created_at as Date).getTime(),
			response: row.response ?? '',
			functions: parsedFunctions ?? [],
			prompt: row.prompt ?? '',
			summary: row.summary ?? '',
			expandedUserRequest: row.expanded_user_request ?? '',
			observationsReasoning: row.observations_reasoning === null ? undefined : row.observations_reasoning,
			agentPlan: row.agent_plan ?? '',
			nextStepDetails: row.next_step_details ?? '',
			code: row.code ?? '',
			executedCode: row.executed_code ?? '',
			draftCode: row.draft_code === null ? undefined : row.draft_code,
			codeReview: row.code_review === null ? undefined : row.code_review,
			images: parsedImages ?? [],
			functionCalls: parsedFunctionCalls ?? [],
			memory: parsedMemory ?? {},
			toolState: parsedToolState === null ? undefined : parsedToolState,
			error: row.error === null ? undefined : row.error,
			stats: parsedStats ?? ({} as GenerationStats),
			cost: row.cost !== null && row.cost !== undefined ? Number.parseFloat(String(row.cost)) : 0,
		};
	}

	async save(state: AgentContext): Promise<void> {
		const dbData = this._serializeContextForDb(state);
		const now = new Date();

		const valuesToInsert: Insertable<AgentContextsTable> = {
			...dbData,
			agent_id: state.agentId,
			// user_id is part of dbData
			// state is part of dbData
			// cost is part of dbData
			// etc.
			created_at: now,
			last_update: now,
		};

		const valuesToUpdate: Updateable<AgentContextsTable> = {
			...dbData,
			// user_id is part of dbData
			// state is part of dbData
			// cost is part of dbData
			// etc.
			last_update: now,
		};

		const saveOperation = async (trx: Transaction<Database>) => {
			await trx
				.insertInto('agent_contexts')
				.values(valuesToInsert)
				.onConflict((oc) => oc.column('agent_id').doUpdateSet(valuesToUpdate)) // valuesToUpdate is a subset of fields for update
				.execute();
		};

		if (state.parentAgentId) {
			await this.db.transaction().execute(async (trx) => {
				const parent = await trx
					.selectFrom('agent_contexts')
					.select(['child_agents_ids'])
					.where('agent_id', '=', state.parentAgentId as string)
					.executeTakeFirst();

				if (!parent) {
					throw new Error(`Parent agent ${state.parentAgentId} not found`);
				}

				// Deserialize child_agents_ids before adding using safe parse
				const childAgents = new Set(this.safeJsonParse<string[] | null>(parent.child_agents_ids, 'child_agents_ids') || []);
				if (!childAgents.has(state.agentId)) {
					childAgents.add(state.agentId);
					await trx
						.updateTable('agent_contexts')
						.set({ child_agents_ids: JSON.stringify(Array.from(childAgents)), last_update: now }) // Serialize back to string
						.where('agent_id', '=', state.parentAgentId as string)
						.execute();
				}
				await saveOperation(trx);
			});
		} else {
			await this.db.transaction().execute(saveOperation);
		}
		state.lastUpdate = now.getTime();
	}

	async updateState(ctx: AgentContext, state: AgentRunningState): Promise<void> {
		const now = new Date();
		await this.db.updateTable('agent_contexts').set({ state: state, last_update: now }).where('agent_id', '=', ctx.agentId).execute();
		ctx.state = state;
		ctx.lastUpdate = now.getTime();
	}

	async load(agentId: string): Promise<AgentContext | null> {
		const row = await this.db.selectFrom('agent_contexts').selectAll().where('agent_id', '=', agentId).executeTakeFirst();
		if (!row) return null;

		if (row.user_id !== currentUser().id) {
			logger.warn({ agentId, currentUserId: currentUser().id, ownerId: row.user_id }, 'Attempt to load agent not owned by current user.');
			throw new NotAllowed(`Access denied to agent ${agentId}.`);
		}

		return this._deserializeDbRowToAgentContext(row);
	}

	async findByMetadata(key: string, value: string): Promise<AgentContext | null> {
		const currentUserId = currentUser().id;

		// Ensure key is a simple string to prevent SQL injection if it were dynamic.
		// For this use case, key is typically a predefined string like 'gitlab'.
		// Using db.val(key) for safety if key could come from untrusted input,
		// but for internal keys, direct interpolation in sql template is common.
		// The jsonb operator `->>` extracts the value as text.
		const row = await this.db
			.selectFrom('agent_contexts')
			.selectAll()
			.where('user_id', '=', currentUserId)
			.where(sql`metadata_serialized->>${key}`, '=', value)
			.executeTakeFirst();

		if (!row) return null;

		// Ownership is already checked by `where('user_id', '=', currentUserId)`
		return this._deserializeDbRowToAgentContext(row);
	}

	async requestHumanInLoopCheck(agent: AgentContext): Promise<void> {
		const now = new Date();
		await this.db.updateTable('agent_contexts').set({ hil_requested: true, last_update: now }).where('agent_id', '=', agent.agentId).execute();
		agent.hilRequested = true;
		agent.lastUpdate = now.getTime();
	}

	async list(): Promise<AgentContextPreview[]> {
		const userId = currentUser().id;
		const rows = await this.db
			.selectFrom('agent_contexts')
			// Select only necessary columns for list view if performance becomes an issue
			.selectAll()
			.where('user_id', '=', userId)
			.orderBy('last_update', 'desc')
			.orderBy('created_at', 'desc') // Secondary sort for deterministic ordering
			.execute();
		// Use Promise.all with map because _deserializeDbRowToAgentContext is async
		const agentContexts = await Promise.all(rows.map((row) => this._deserializeDbRowToAgentContext(row)));
		return agentContexts.map((agent) => ({
			agentId: agent.agentId,
			name: agent.name,
			state: agent.state,
			type: agent.type,
			subtype: agent.subtype,
			cost: agent.cost ?? 0,
			error: agent.error,
			lastUpdate: agent.lastUpdate,
			userPrompt: agent.userPrompt,
			inputPrompt: agent.inputPrompt,
			user: agent.user.id,
			createdAt: agent.createdAt,
			metadata: agent.metadata,
			parentAgentId: agent.parentAgentId,
		}));
	}

	async listRunning(): Promise<AgentContextPreview[]> {
		const userId = currentUser().id;
		const terminalStates: AgentRunningState[] = ['completed', 'restart', 'timeout', 'error'];
		const rows = await this.db
			.selectFrom('agent_contexts')
			// Select only necessary columns for list view
			.selectAll()
			.where('user_id', '=', userId)
			.where('state', 'not in', terminalStates)
			.orderBy('state', 'asc')
			.orderBy('last_update', 'desc')
			.orderBy('created_at', 'desc') // Secondary sort for deterministic ordering
			.execute();
		// Use Promise.all with map because _deserializeDbRowToAgentContext is async
		const agentContexts = await Promise.all(rows.map((row) => this._deserializeDbRowToAgentContext(row)));
		return agentContexts.map((agent) => ({
			agentId: agent.agentId,
			name: agent.name,
			type: agent.type,
			subtype: agent.subtype,
			state: agent.state,
			cost: agent.cost ?? 0,
			error: agent.error,
			lastUpdate: agent.lastUpdate,
			userPrompt: agent.userPrompt,
			inputPrompt: agent.inputPrompt,
			user: agent.user.id,
			createdAt: agent.createdAt,
			metadata: agent.metadata,
			parentAgentId: agent.parentAgentId,
		}));
	}

	async clear(): Promise<void> {
		// Order matters due to foreign key constraints if ON DELETE CASCADE is not set for iterations table
		await this.db.deleteFrom('agent_iterations').execute();
		await this.db.deleteFrom('agent_contexts').execute();
	}

	async delete(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const userId = currentUser().id;

		const agentsToDeleteDetails = await this.db
			.selectFrom('agent_contexts')
			.select(['agent_id', 'user_id', 'state', 'parent_agent_id', 'child_agents_ids'])
			.where('agent_id', 'in', ids)
			.execute();

		const validParentAgentsToDelete = agentsToDeleteDetails.filter(
			(agent) =>
				agent.user_id === userId && (!agent.state || !isExecuting({ state: agent.state as AgentRunningState } as AgentContext)) && !agent.parent_agent_id,
		);

		const allIdsToDelete = new Set<string>();
		for (const agent of validParentAgentsToDelete) {
			allIdsToDelete.add(agent.agent_id);
			// Deserialize child_agents_ids before adding to the set using safe parse
			if (agent.child_agents_ids) {
				const childIds = this.safeJsonParse<string[] | null>(agent.child_agents_ids, 'child_agents_ids');
				if (childIds) {
					for (const childId of childIds) {
						allIdsToDelete.add(childId);
					}
				}
			}
		}

		if (allIdsToDelete.size === 0) return;

		const finalIdsArray = Array.from(allIdsToDelete);
		await this.db.transaction().execute(async (trx) => {
			await trx.deleteFrom('agent_iterations').where('agent_id', 'in', finalIdsArray).execute();
			await trx.deleteFrom('agent_contexts').where('agent_id', 'in', finalIdsArray).execute();
		});
	}

	async updateFunctions(agentId: string, functions: string[]): Promise<void> {
		// Load the agent first to check existence and ownership
		const agent = await this.load(agentId); // This will throw NotAllowed if necessary
		if (!agent) throw new NotFound(`Agent with ID ${agentId} not found.`);
		// Agent is guaranteed to exist and be owned by the current user here

		const newLlmFunctions = new LlmFunctionsImpl();
		const factory = functionFactory();
		for (const functionName of functions) {
			const FunctionClass = factory[functionName];
			if (FunctionClass) {
				newLlmFunctions.addFunctionClass(FunctionClass);
			} else {
				logger.warn(`Function ${functionName} not found in function factory`);
			}
		}
		agent.functions = newLlmFunctions; // Update in-memory agent

		// Serialize just the functions part for DB update
		const serializedFunctions = serializeContext(agent).functions;

		await this.db
			.updateTable('agent_contexts')
			.set({ functions_serialized: JSON.stringify(serializedFunctions), last_update: new Date() }) // Serialize functions
			.where('agent_id', '=', agentId)
			.execute();
	}

	async saveIteration(iterationData: AutonomousIteration): Promise<void> {
		if (!Number.isInteger(iterationData.iteration) || iterationData.iteration <= 0) throw new Error('Iteration number must be a positive integer.');
		if (!iterationData.agentId) throw new Error('Agent ID is required for iteration data.');

		const agent = await this.load(iterationData.agentId); // This will throw NotAllowed if necessary
		if (!agent) throw new NotFound(`Agent with ID ${iterationData.agentId} not found.`);

		const dbData = this._serializeIterationForDb(iterationData);

		const valuesToInsert: Insertable<AgentIterationsTable> = {
			...dbData,
			agent_id: iterationData.agentId,
			iteration_number: iterationData.iteration,
			created_at: iterationData.createdAt ? new Date(iterationData.createdAt) : new Date(),
		};

		// For ON CONFLICT DO UPDATE, Kysely expects a subset of Updateable<AgentIterationsTable>
		// We need to construct this carefully, excluding primary keys from the set clause.
		const { agent_id, iteration_number, created_at, ...updateData } = valuesToInsert;
		const valuesToUpdate: Updateable<AgentIterationsTable> = {
			...updateData, // Contains all fields from dbData
			// created_at should not be updated by onConflict typically, but if it were, it would be `created_at: now,`
			// For this model, we are updating all non-PK fields.
		};

		await this.db
			.insertInto('agent_iterations')
			.values(valuesToInsert)
			.onConflict((oc) => oc.columns(['agent_id', 'iteration_number']).doUpdateSet(valuesToUpdate))
			.execute();
	}

	async loadIterations(agentId: string): Promise<AutonomousIteration[]> {
		// Load the agent first to check existence and ownership
		const agent = await this.load(agentId); // This will throw NotAllowed if necessary
		if (!agent) throw new NotFound(`Agent with ID ${agentId} not found.`);

		const rows = await this.db.selectFrom('agent_iterations').selectAll().where('agent_id', '=', agentId).orderBy('iteration_number', 'asc').execute();

		return rows.map((row) => this._deserializeDbRowToIteration(row));
	}

	async getAgentIterationSummaries(agentId: string): Promise<AutonomousIterationSummary[]> {
		// Load the agent first to check existence and ownership
		const agent = await this.load(agentId); // This will throw NotAllowed if necessary
		if (!agent) throw new NotFound(`Agent with ID ${agentId} not found.`);

		const rows = await this.db
			.selectFrom('agent_iterations')
			.select(['agent_id', 'iteration_number', 'created_at', 'cost', 'summary', 'error'])
			.where('agent_id', '=', agentId)
			.orderBy('iteration_number', 'asc')
			.execute();

		return rows.map((row) => ({
			agentId: row.agent_id,
			iteration: row.iteration_number,
			createdAt: (row.created_at as Date).getTime(),
			cost: row.cost !== null && row.cost !== undefined ? Number.parseFloat(String(row.cost)) : 0,
			summary: row.summary ?? '',
			error: row.error,
		}));
	}

	async getAgentIterationDetail(agentId: string, iterationNumber: number): Promise<AutonomousIteration> {
		// Load the agent first to check existence and ownership
		await this.load(agentId); // This will throw NotFound or NotAllowed if necessary

		const row = await this.db
			.selectFrom('agent_iterations')
			.selectAll()
			.where('agent_id', '=', agentId)
			.where('iteration_number', '=', iterationNumber)
			.executeTakeFirst();

		if (!row) {
			throw new NotFound(`Iteration ${iterationNumber} for agent ${agentId} not found.`);
		}

		return this._deserializeDbRowToIteration(row);
	}
}
