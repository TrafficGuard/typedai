import { randomUUID } from 'node:crypto';
import type { Insertable, Selectable, Updateable } from 'kysely';

import { agentContext } from '#agent/agentContextLocalStorage';
import { callStack as getCallStackString } from '#llm/llmCallService/llmCall';
import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { LlmCall } from '#shared/model/llmCall.model';
import type { CallSettings, LlmMessage } from '#shared/model/llm.model';
import { currentUser } from '#user/userContext';
import { db, type LlmCallsTable } from './db';

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
			error: row.error ?? undefined,
			// llmCallId is Firestore-specific, not populated here
			// warning is not in DB schema
			// chunkCount is not in DB schema
		};
	}

	@span()
	async saveRequest(request: CreateLlmRequest): Promise<LlmCall> {
		const id = randomUUID();
		const requestTime = Date.now();

		const currentAgentContext = agentContext();
		const currentAppUser = currentUser();

		const agentId = request.agentId ?? currentAgentContext?.agentId;
		const userId = request.userId ?? currentAppUser?.id;
		const callStack = request.callStack ?? getCallStackString(currentAgentContext);

		const llmCall: LlmCall = {
			id,
			...request, // contains messages, settings, llmId, description, and potentially agentId, userId, callStack if provided in CreateLlmRequest
			requestTime,
			// Ensure these are the resolved values
			agentId,
			userId,
			callStack,
		};

		const insertData: Insertable<LlmCallsTable> = {
			id: llmCall.id,
			description: llmCall.description ?? null,
			messages_serialized: JSON.stringify(llmCall.messages),
			settings_serialized: JSON.stringify(llmCall.settings),
			request_time: new Date(llmCall.requestTime),
			agent_id: llmCall.agentId ?? null,
			user_id: llmCall.userId ?? null,
			call_stack: llmCall.callStack ?? null,
			llm_id: llmCall.llmId, // llmId is non-optional in LlmCall and CreateLlmRequest
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
		return llmCall;
	}

	@span()
	async saveResponse(llmCall: LlmCall): Promise<void> {
		if (!llmCall.id) {
			logger.error('LlmCall ID is required to save response.');
			throw new Error('LlmCall ID is required to save response.');
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

		const result = await db
			.updateTable('llm_calls')
			.set(updateData)
			.where('id', '=', llmCall.id)
			.executeTakeFirst();

		if (Number(result?.numUpdatedRows ?? 0) === 0) {
			logger.warn({ llmCallId: llmCall.id }, 'No LLM call found to update for saveResponse [llmCallId]');
			// Consider if this should throw an error, e.g., if an update is always expected to modify a row.
			// For now, it logs a warning.
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
	async getLlmCallsForAgent(agentId: string): Promise<LlmCall[]> {
		const rows = await db
			.selectFrom('llm_calls')
			.selectAll()
			.where('agent_id', '=', agentId)
			.orderBy('request_time', 'desc')
			.execute();
		return rows.map((row) => this.docToLlmCall(row));
	}

	@span()
	async getLlmCallsByDescription(description: string): Promise<LlmCall[]> {
		const rows = await db
			.selectFrom('llm_calls')
			.selectAll()
			.where('description', '=', description)
			.orderBy('request_time', 'desc')
			.execute();
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
