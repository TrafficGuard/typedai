import type { Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import { deserializeContext, serializeContext } from '#agent/agentSerialization';
import { functionFactory } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { type AgentContext, type AgentRunningState, type AgentType, type AutonomousIteration, isExecuting } from '#shared/model/agent.model';
import type { User } from '#shared/model/user.model';
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
			typed_ai_repo_dir: serialized.typedAiRepoDir,
			trace_id: serialized.traceId,
			name: serialized.name,
			parent_agent_id: serialized.parentAgentId,
			user_id: serialized.user,
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
			live_files_serialized: serialized.liveFiles ? JSON.stringify(serialized.liveFiles) : null,
			child_agents_ids: serialized.childAgents ? JSON.stringify(serialized.childAgents) : null,
			hil_requested: serialized.hilRequested,
		};
	}

	private async _deserializeDbRowToAgentContext(row: Selectable<AgentContextsTable>): Promise<AgentContext> {
		const userForDeserialization = currentUser().id === row.user_id ? currentUser() : ({ id: row.user_id } as User);

		const dataForDeserialization = {
			agentId: row.agent_id,
			executionId: row.execution_id,
			typedAiRepoDir: row.typed_ai_repo_dir,
			traceId: row.trace_id,
			name: row.name,
			parentAgentId: row.parent_agent_id,
			user: userForDeserialization,
			state: row.state as AgentRunningState,
			callStack: row.call_stack ? JSON.parse(row.call_stack) : null,
			error: row.error,
			hilBudget: row.hil_budget,
			hilCount: row.hil_count,
			cost: row.cost,
			budgetRemaining: row.budget_remaining,
			llms: JSON.parse(row.llms_serialized),
			useSharedRepos: row.use_shared_repos,
			memory: JSON.parse(row.memory_serialized),
			lastUpdate: (row.last_update as Date).getTime(),
			metadata: row.metadata_serialized ? JSON.parse(row.metadata_serialized) : null,
			functions: JSON.parse(row.functions_serialized),
			completedHandler: row.completed_handler_id,
			pendingMessages: row.pending_messages_serialized ? JSON.parse(row.pending_messages_serialized) : null,
			type: row.type as AgentType,
			subtype: row.subtype,
			iterations: row.iterations,
			invoking: row.invoking_serialized ? JSON.parse(row.invoking_serialized) : null,
			notes: row.notes_serialized ? JSON.parse(row.notes_serialized) : null,
			userPrompt: row.user_prompt,
			inputPrompt: row.input_prompt,
			messages: JSON.parse(row.messages_serialized),
			functionCallHistory: row.function_call_history_serialized ? JSON.parse(row.function_call_history_serialized) : null,
			liveFiles: row.live_files_serialized ? JSON.parse(row.live_files_serialized) : null,
			childAgents: row.child_agents_ids ? JSON.parse(row.child_agents_ids) : null,
			hilRequested: row.hil_requested,
		};
		return deserializeContext(dataForDeserialization as any);
	}

	private _serializeIterationForDb(iteration: AutonomousIteration): SerializedAgentIterationData {
		return {
			functions_serialized: iteration.functions ? JSON.stringify(iteration.functions) : null,
			prompt: iteration.prompt,
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
			tool_state_serialized: iteration.toolState ? JSON.stringify(iteration.toolState instanceof Map ? Object.fromEntries(iteration.toolState) : iteration.toolState) : null,
			error: iteration.error,
			stats_serialized: iteration.stats ? JSON.stringify(iteration.stats) : null,
			cost: iteration.cost,
		};
	}

	private _deserializeDbRowToIteration(row: Selectable<AgentIterationsTable>): AutonomousIteration {
		return {
			agentId: row.agent_id,
			iteration: row.iteration_number,
			functions: row.functions_serialized ? JSON.parse(row.functions_serialized) : [],
			prompt: row.prompt,
			summary: row.summary,
			expandedUserRequest: row.expanded_user_request,
			observationsReasoning: row.observations_reasoning,
			agentPlan: row.agent_plan,
			nextStepDetails: row.next_step_details,
			code: row.code,
			executedCode: row.executed_code,
			draftCode: row.draft_code,
			codeReview: row.code_review,
			images: row.images_serialized ? JSON.parse(row.images_serialized) : [],
			functionCalls: row.function_calls_serialized ? JSON.parse(row.function_calls_serialized) : [],
			memory: row.memory_serialized ? JSON.parse(row.memory_serialized) : {},
			toolState: row.tool_state_serialized ? JSON.parse(row.tool_state_serialized) : {},
			error: row.error,
			stats: row.stats_serialized ? JSON.parse(row.stats_serialized) : null,
			cost: row.cost,
			// created_at is not part of AutonomousIteration model
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

				// Deserialize child_agents_ids before adding
				const childAgents = new Set(parent.child_agents_ids ? JSON.parse(parent.child_agents_ids) : []);
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
		return this._deserializeDbRowToAgentContext(row);
	}

	async requestHumanInLoopCheck(agent: AgentContext): Promise<void> {
		const now = new Date();
		await this.db.updateTable('agent_contexts').set({ hil_requested: true, last_update: now }).where('agent_id', '=', agent.agentId).execute();
		agent.hilRequested = true;
		agent.lastUpdate = now.getTime();
	}

	async list(): Promise<AgentContext[]> {
		const userId = currentUser().id;
		const rows = await this.db
			.selectFrom('agent_contexts')
			// Select only necessary columns for list view if performance becomes an issue
			.selectAll()
			.where('user_id', '=', userId)
			.orderBy('last_update', 'desc')
			.execute();
		return Promise.all(rows.map((row) => this._deserializeDbRowToAgentContext(row)));
	}

	async listRunning(): Promise<AgentContext[]> {
		const userId = currentUser().id;
		const terminalStates: AgentRunningState[] = ['completed', 'shutdown', 'timeout', 'error'];
		const rows = await this.db
			.selectFrom('agent_contexts')
			// Select only necessary columns for list view
			.selectAll()
			.where('user_id', '=', userId)
			.where('state', 'not in', terminalStates)
			.orderBy('state', 'asc')
			.orderBy('last_update', 'desc')
			.execute();
		return Promise.all(rows.map((row) => this._deserializeDbRowToAgentContext(row)));
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
			// Deserialize child_agents_ids before adding to the set
			if (agent.child_agents_ids) {
				const childIds = JSON.parse(agent.child_agents_ids) as string[];
				for (const childId of childIds) {
					allIdsToDelete.add(childId);
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
		const agent = await this.load(agentId);
		if (!agent) throw new Error(`Agent not found: ${agentId}`);
		if (agent.user.id !== currentUser().id) {
			throw new Error('Cannot update functions for an agent you do not own.');
		}

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
		if (!Number.isInteger(iterationData.iteration) || iterationData.iteration <= 0) {
			throw new Error('Iteration number must be a positive integer.');
		}
		const dbData = this._serializeIterationForDb(iterationData);
		const now = new Date();

		const valuesToInsert: Insertable<AgentIterationsTable> = {
			...dbData,
			agent_id: iterationData.agentId,
			iteration_number: iterationData.iteration,
			created_at: now,
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
		const agent = await this.load(agentId); // Checks existence and ownership implicitly via currentUser in load
		if (!agent) throw new Error(`Agent Id does not exist or you do not have permission: ${agentId}`);
		// No explicit user check here as load() would have failed or returned null if user mismatch for some implementations.
		// However, for safety, an explicit check against currentUser() might be good if load() doesn't guarantee it.
		// The shared test suite implies load() should work for the current user.

		const rows = await this.db.selectFrom('agent_iterations').selectAll().where('agent_id', '=', agentId).orderBy('iteration_number', 'asc').execute();

		return rows.map((row) => this._deserializeDbRowToIteration(row));
	}
}
