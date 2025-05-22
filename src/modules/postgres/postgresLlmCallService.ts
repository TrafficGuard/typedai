import { randomUUID } from 'node:crypto';
import type { Insertable, Selectable, Updateable } from 'kysely';

import { agentContext } from '#agent/agentContextLocalStorage';
import { callStack as getCallStackString } from '#llm/llmCallService/llmCall';
import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { CallSettings, LlmMessage } from '#shared/model/llm.model';
import type { LlmCall } from '#shared/model/llmCall.model';
import { currentUser } from '#user/userContext';
import { type LlmCallsTable, db } from './db';

export class PostgresLlmCallService implements LlmCallService {
	private docToLlmCall(row: Selectable<LlmCallsTable>): LlmCall {
		const messages = JSON.parse(row.messages_serialized) as LlmMessage[] | ReadonlyArray<LlmMessage>;
		const settings = JSON.parse(row.settings_serialized) as CallSettings;

		// Note: row.cached_input_tokens from DB is a single value.
		// LlmCall model has cacheCreationInputTokens and cacheReadInputTokens.
		// These cannot be accurately reconstructed from the single DB value, so they will be undefined.
		const llmIdFromDb = row.llm_id;
		if (!llmIdFromDb) {
			// This case should ideally not happen if data is consistent, as llmId is mandatory in LlmCall
			logger.error({ llmCallId: row.id }, 'Corrupt LlmCall data: llm_id is null in database [llmCallId]');
			throw new Error(`Corrupt LlmCall data: llm_id is null for call ${row.id}`);
		}

		return {
			id: row.id,
			description: row.description ?? undefined,
			messages,
			settings,
			requestTime: new Date(row.request_time).getTime(),
			agentId: row.agent_id ?? undefined,
			userId: row.user_id ?? undefined,
			callStack: row.call_stack ?? undefined,
			llmId: llmIdFromDb,
			timeToFirstToken: row.time_to_first_token ?? undefined,
			totalTime: row.total_time ?? undefined,
			cost: row.cost ?? undefined,
			inputTokens: row.input_tokens ?? undefined,
			outputTokens: row.output_tokens ?? undefined,
			// cacheCreationInputTokens and cacheReadInputTokens remain undefined as they can't be derived from row.cached_input_tokens
			cacheCreationInputTokens: undefined, // Not stored separately in Postgres
			cacheReadInputTokens: undefined, // Not stored separately in Postgres
			error: row.error ?? undefined,
			llmCallId: undefined, // Firestore-specific, not used in Postgres
			warning: undefined, // Not in DB schema, default to undefined
			chunkCount: undefined, // Not in DB schema, default to undefined
		};
	}

	@span()
	async saveRequest(request: CreateLlmRequest): Promise<LlmCall> {
		const id = randomUUID();
		const requestTime = Date.now();

		const currentAgentContext = agentContext();
		const currentAppUser = currentUser();

		// Determine agentId: Use request.agentId if explicitly provided (even if undefined), otherwise use agentContext
		const agentId = 'agentId' in request ? request.agentId : currentAgentContext?.agentId;
		// Determine userId: Use request.userId if explicitly provided (even if undefined), otherwise use currentUser
		const userId = 'userId' in request ? request.userId : currentAppUser?.id;
		// Determine callStack: Use request.callStack if explicitly provided (even if undefined), otherwise generate from agentContext
		const callStack = 'callStack' in request ? request.callStack : getCallStackString(currentAgentContext);

		// Construct the full LlmCall object to be returned and for preparing insertData
		const llmCallToReturn: LlmCall = {
			id,
			...request, // contains messages, settings, llmId, description, and potentially agentId, userId, callStack if provided in CreateLlmRequest
			requestTime,
			// Ensure these are the resolved values
			agentId,
			userId,
			callStack,
			// Initialize optional LlmCall fields not present in CreateLlmRequest
			timeToFirstToken: undefined,
			totalTime: undefined,
			cost: undefined,
			inputTokens: undefined,
			outputTokens: undefined,
			cacheCreationInputTokens: undefined,
			cacheReadInputTokens: undefined,
			chunkCount: undefined, // Postgres doesn't use chunking
			warning: undefined,
			error: undefined,
			llmCallId: undefined, // Postgres doesn't use this for chunking
		};

		const insertData: Insertable<LlmCallsTable> = {
			id: llmCallToReturn.id,
			description: llmCallToReturn.description ?? null,
			messages_serialized: JSON.stringify(llmCallToReturn.messages),
			settings_serialized: JSON.stringify(llmCallToReturn.settings),
			request_time: new Date(llmCallToReturn.requestTime),
			agent_id: llmCallToReturn.agentId ?? null,
			user_id: llmCallToReturn.userId ?? null,
			call_stack: llmCallToReturn.callStack ?? null,
			llm_id: llmCallToReturn.llmId, // llmId is non-optional in LlmCall and CreateLlmRequest
			time_to_first_token: null,
			total_time: null,
			cost: null,
			input_tokens: null,
			output_tokens: null,
			cached_input_tokens: null,
			error: null,
		};

		await db.insertInto('llm_calls').values(insertData).execute();
		logger.debug({ llmCallId: id, agentId, userId }, 'LLM request saved [llmCallId] [agentId] [userId]');
		return llmCallToReturn;
	}

	@span()
	async saveResponse(llmCall: LlmCall): Promise<void> {
		if (!llmCall.id) {
			logger.error('LlmCall ID is required to save response.');
			throw new Error('LlmCall ID is required to save response.');
		}

		// Check if the record exists before attempting to update
		const existingCall = await this.getCall(llmCall.id);
		if (!existingCall) {
			throw new Error(`LlmCall with ID ${llmCall.id} not found, cannot save response.`);
		}

		const creation = llmCall.cacheCreationInputTokens;
		const read = llmCall.cacheReadInputTokens;
		let cachedInputTokensDbValue: number | null = null;
		if (creation !== undefined || read !== undefined) {
			cachedInputTokensDbValue = (creation ?? 0) + (read ?? 0);
		}

		const updateData: Omit<Updateable<LlmCallsTable>, 'id' | 'created_at' | 'request_time' | 'description' | 'agent_id' | 'user_id' | 'call_stack'> = {
			messages_serialized: JSON.stringify(llmCall.messages),
			settings_serialized: JSON.stringify(llmCall.settings), // In case settings can be updated (though unlikely)
			time_to_first_token: llmCall.timeToFirstToken ?? null,
			total_time: llmCall.totalTime ?? null,
			cost: llmCall.cost ?? null,
			input_tokens: llmCall.inputTokens ?? null,
			output_tokens: llmCall.outputTokens ?? null,
			cached_input_tokens: cachedInputTokensDbValue,
			error: llmCall.error ?? null,
			llm_id: llmCall.llmId, // llmId is part of LlmRequest, but can be re-affirmed here
		};

		const result = await db.updateTable('llm_calls').set(updateData).where('id', '=', llmCall.id).executeTakeFirst();

		if (Number(result?.numUpdatedRows ?? 0) === 0) {
			logger.warn({ llmCallId: llmCall.id }, 'No LLM call found to update for saveResponse [llmCallId]');
			// This path should ideally not be hit if the existence check above is in place and works.
		} else {
			logger.debug({ llmCallId: llmCall.id }, 'LLM response saved [llmCallId]');
		}
	}

	@span()
	async getCall(llmCallId: string): Promise<LlmCall | null> {
		const row = await db.selectFrom('llm_calls').selectAll().where('id', '=', llmCallId).executeTakeFirst();
		if (!row) {
			return null;
		}
		return this.docToLlmCall(row);
	}

	@span()
	async getLlmCallsForAgent(agentId: string, limit?: number): Promise<LlmCall[]> {
		let query = db.selectFrom('llm_calls').selectAll().where('agent_id', '=', agentId).orderBy('request_time', 'desc');

		if (limit !== undefined) {
			query = query.limit(limit);
		}

		const rows = await query.execute();
		return rows.map((row) => this.docToLlmCall(row));
	}

	@span()
	async getLlmCallsByDescription(description: string, agentId?: string, limit?: number): Promise<LlmCall[]> {
		let query = db.selectFrom('llm_calls').selectAll().where('description', '=', description).orderBy('request_time', 'desc');

		if (agentId !== undefined) {
			query = query.where('agent_id', '=', agentId);
		}

		if (limit !== undefined) {
			query = query.limit(limit);
		}

		const rows = await query.execute();
		return rows.map((row) => this.docToLlmCall(row));
	}

	@span()
	async delete(llmCallId: string): Promise<void> {
		const result = await db.deleteFrom('llm_calls').where('id', '=', llmCallId).executeTakeFirst();
		if (Number(result.numDeletedRows) === 0) {
			logger.warn({ llmCallId }, 'Attempted to delete non-existent LLM call [llmCallId]');
			// Depending on desired behavior, could throw an error if deletion must target an existing record.
		} else {
			logger.info({ llmCallId }, 'LLM call deleted [llmCallId]');
		}
	}
}
