import type { Insertable, Selectable, Updateable } from 'kysely';
import type { DebateStateService } from '#modules/debate/debateStateService';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type {
	DebateConfig,
	DebateList,
	DebatePhase,
	DebateResult,
	DebateRound,
	DebateState,
	DebaterConfig,
	HitlDecision,
	SynthesizedAnswer,
	VerifiedAnswer,
} from '#shared/debate/debate.model';
import { NotFound, Unauthorized } from '#shared/errors';
import { currentUser } from '#user/userContext';
import { type DebateResultsTable, type DebatesTable, db } from './db';

/**
 * PostgreSQL implementation of DebateStateService
 * Uses Kysely for type-safe database operations
 */
export class PostgresDebateStateService implements DebateStateService {
	// ============================================================================
	// Mapping Functions - DebatesTable <-> DebateState
	// ============================================================================

	private mapDbRowToDebate(row: Selectable<DebatesTable>): DebateState {
		return {
			debateId: row.id,
			userId: row.user_id ?? undefined,
			topic: row.topic,
			backgroundContext: row.background_context ?? undefined,
			phase: row.phase as DebatePhase,
			previousPhase: row.previous_phase ? (row.previous_phase as DebatePhase) : undefined,
			currentRound: row.current_round,
			debaters: JSON.parse(row.debaters_serialized) as DebaterConfig[],
			rounds: JSON.parse(row.rounds_serialized) as DebateRound[],
			config: JSON.parse(row.config_serialized) as DebateConfig,
			hitlDecision: row.hitl_decision_serialized ? (JSON.parse(row.hitl_decision_serialized) as HitlDecision) : undefined,
			startTime: new Date(row.start_time).getTime(),
			endTime: row.end_time ? new Date(row.end_time).getTime() : undefined,
			error: row.error ?? undefined,
		};
	}

	private mapDebateToDbInsert(debate: DebateState): Insertable<DebatesTable> {
		return {
			id: debate.debateId,
			user_id: debate.userId ?? null,
			topic: debate.topic,
			background_context: debate.backgroundContext ?? null,
			phase: debate.phase,
			previous_phase: debate.previousPhase ?? null,
			current_round: debate.currentRound,
			debaters_serialized: JSON.stringify(debate.debaters),
			rounds_serialized: JSON.stringify(debate.rounds),
			config_serialized: JSON.stringify(debate.config),
			hitl_decision_serialized: debate.hitlDecision ? JSON.stringify(debate.hitlDecision) : null,
			start_time: new Date(debate.startTime),
			end_time: debate.endTime ? new Date(debate.endTime) : null,
			error: debate.error ?? null,
		};
	}

	private mapDebateToDbUpdate(updates: Partial<DebateState>): Omit<Updateable<DebatesTable>, 'id' | 'created_at'> {
		const updateData: Partial<Omit<Updateable<DebatesTable>, 'id' | 'created_at'>> = {};

		if (updates.topic !== undefined) updateData.topic = updates.topic;
		if (updates.backgroundContext !== undefined) updateData.background_context = updates.backgroundContext ?? null;
		if (updates.phase !== undefined) updateData.phase = updates.phase;
		if (updates.previousPhase !== undefined) updateData.previous_phase = updates.previousPhase ?? null;
		if (updates.currentRound !== undefined) updateData.current_round = updates.currentRound;
		if (updates.debaters !== undefined) updateData.debaters_serialized = JSON.stringify(updates.debaters);
		if (updates.rounds !== undefined) updateData.rounds_serialized = JSON.stringify(updates.rounds);
		if (updates.config !== undefined) updateData.config_serialized = JSON.stringify(updates.config);
		if (updates.hitlDecision !== undefined) updateData.hitl_decision_serialized = updates.hitlDecision ? JSON.stringify(updates.hitlDecision) : null;
		if (updates.startTime !== undefined) updateData.start_time = new Date(updates.startTime);
		if (updates.endTime !== undefined) updateData.end_time = updates.endTime ? new Date(updates.endTime) : null;
		if (updates.error !== undefined) updateData.error = updates.error ?? null;

		return updateData;
	}

	// ============================================================================
	// Mapping Functions - DebateResultsTable <-> DebateResult
	// ============================================================================

	private mapDbRowToResult(row: Selectable<DebateResultsTable>): DebateResult {
		return {
			debateId: row.debate_id,
			topic: row.topic,
			synthesizedAnswer: JSON.parse(row.synthesized_answer_serialized) as SynthesizedAnswer,
			verifiedAnswer: JSON.parse(row.verified_answer_serialized) as VerifiedAnswer,
			rounds: JSON.parse(row.rounds_serialized) as DebateRound[],
			roundCount: row.round_count,
			consensusReached: row.consensus_reached,
			hitlInvoked: row.hitl_invoked,
			executionTimeMs: row.execution_time_ms,
			totalCost: row.total_cost ?? undefined,
		};
	}

	private mapResultToDbInsert(debateId: string, result: DebateResult): Insertable<DebateResultsTable> {
		return {
			debate_id: debateId,
			topic: result.topic,
			synthesized_answer_serialized: JSON.stringify(result.synthesizedAnswer),
			verified_answer_serialized: JSON.stringify(result.verifiedAnswer),
			rounds_serialized: JSON.stringify(result.rounds),
			round_count: result.roundCount,
			consensus_reached: result.consensusReached,
			hitl_invoked: result.hitlInvoked,
			execution_time_ms: result.executionTimeMs,
			total_cost: result.totalCost ?? null,
		};
	}

	// ============================================================================
	// DebateStateService Implementation
	// ============================================================================

	@span()
	async createDebate(state: DebateState): Promise<DebateState> {
		const userId = currentUser().id;

		if (!state.debateId) {
			throw new Error('Debate ID is required');
		}

		// Check if debate already exists
		const existing = await db.selectFrom('debates').select('id').where('id', '=', state.debateId).executeTakeFirst();

		if (existing) {
			throw new Error(`Debate with ID ${state.debateId} already exists`);
		}

		const debate: DebateState = {
			...state,
			userId: state.userId ?? userId,
			startTime: state.startTime ?? Date.now(),
		};

		const insertData = this.mapDebateToDbInsert(debate);
		const row = await db.insertInto('debates').values(insertData).returningAll().executeTakeFirstOrThrow();

		logger.info(`Created debate ${debate.debateId}`);

		return this.mapDbRowToDebate(row);
	}

	@span()
	async getDebate(debateId: string): Promise<DebateState | null> {
		const userId = currentUser().id;
		const row = await db.selectFrom('debates').selectAll().where('id', '=', debateId).executeTakeFirst();

		if (!row) {
			return null;
		}

		// Check authorization - users can only see their own debates
		if (row.user_id && row.user_id !== userId) {
			throw new Unauthorized('Not authorized to view this debate');
		}

		return this.mapDbRowToDebate(row);
	}

	@span()
	async updateDebate(debateId: string, updates: Partial<DebateState>): Promise<DebateState> {
		const userId = currentUser().id;

		// First verify the debate exists and user has access
		const existing = await db.selectFrom('debates').selectAll().where('id', '=', debateId).executeTakeFirst();

		if (!existing) {
			throw new NotFound(`Debate with ID ${debateId} not found`);
		}

		if (existing.user_id && existing.user_id !== userId) {
			throw new Unauthorized('Not authorized to modify this debate');
		}

		const updateData = this.mapDebateToDbUpdate(updates);

		const row = await db.updateTable('debates').set(updateData).where('id', '=', debateId).returningAll().executeTakeFirst();

		if (!row) {
			throw new NotFound(`Debate with ID ${debateId} not found after update`);
		}

		logger.info(`Updated debate ${debateId}`);

		return this.mapDbRowToDebate(row);
	}

	@span()
	async listDebates(userId?: string, startAfterId?: string, limit = 50): Promise<DebateList> {
		const currentUserId = userId ?? currentUser().id;

		let query = db.selectFrom('debates').selectAll().where('user_id', '=', currentUserId).orderBy('start_time', 'desc').orderBy('id', 'desc');

		// Handle pagination cursor
		if (startAfterId) {
			const cursorDoc = await db
				.selectFrom('debates')
				.select(['start_time', 'id'])
				.where('id', '=', startAfterId)
				.where('user_id', '=', currentUserId)
				.executeTakeFirst();

			if (cursorDoc) {
				query = query.where((eb) =>
					eb.or([eb('start_time', '<', cursorDoc.start_time), eb.and([eb('start_time', '=', cursorDoc.start_time), eb('id', '<', cursorDoc.id)])]),
				);
			}
		}

		const rows = await query.limit(limit + 1).execute();

		const debates = rows.slice(0, limit).map((row) => this.mapDbRowToDebate(row));
		const hasMore = rows.length > limit;

		return { debates, hasMore };
	}

	@span()
	async deleteDebate(debateId: string): Promise<void> {
		const userId = currentUser().id;

		// Check if debate exists and user has access
		const existing = await db.selectFrom('debates').select(['id', 'user_id']).where('id', '=', debateId).executeTakeFirst();

		if (!existing) {
			throw new NotFound(`Debate with ID ${debateId} not found`);
		}

		if (existing.user_id && existing.user_id !== userId) {
			throw new Unauthorized('Not authorized to delete this debate');
		}

		// Delete associated result first (foreign key constraint)
		await db.deleteFrom('debate_results').where('debate_id', '=', debateId).execute();

		// Delete the debate
		const result = await db.deleteFrom('debates').where('id', '=', debateId).executeTakeFirst();

		if (Number(result.numDeletedRows) === 0) {
			logger.warn(`Debate with id ${debateId} was not deleted, though ownership check passed. It might have been deleted concurrently.`);
		} else {
			logger.info(`Deleted debate ${debateId}`);
		}
	}

	@span()
	async saveResult(debateId: string, result: DebateResult): Promise<void> {
		const userId = currentUser().id;

		// Verify debate exists and user has access
		const debate = await db.selectFrom('debates').select(['id', 'user_id']).where('id', '=', debateId).executeTakeFirst();

		if (!debate) {
			throw new NotFound(`Debate with ID ${debateId} not found`);
		}

		if (debate.user_id && debate.user_id !== userId) {
			throw new Unauthorized('Not authorized to save result for this debate');
		}

		const insertData = this.mapResultToDbInsert(debateId, result);

		// Use upsert to handle both insert and update cases
		await db
			.insertInto('debate_results')
			.values(insertData)
			.onConflict((oc) =>
				oc.column('debate_id').doUpdateSet({
					topic: insertData.topic,
					synthesized_answer_serialized: insertData.synthesized_answer_serialized,
					verified_answer_serialized: insertData.verified_answer_serialized,
					rounds_serialized: insertData.rounds_serialized,
					round_count: insertData.round_count,
					consensus_reached: insertData.consensus_reached,
					hitl_invoked: insertData.hitl_invoked,
					execution_time_ms: insertData.execution_time_ms,
					total_cost: insertData.total_cost,
				}),
			)
			.execute();

		logger.info(`Saved result for debate ${debateId}`);
	}

	@span()
	async getResult(debateId: string): Promise<DebateResult | null> {
		const userId = currentUser().id;

		// First verify debate exists and user has access
		const debate = await db.selectFrom('debates').select(['id', 'user_id']).where('id', '=', debateId).executeTakeFirst();

		if (!debate) {
			return null;
		}

		if (debate.user_id && debate.user_id !== userId) {
			throw new Unauthorized('Not authorized to view result for this debate');
		}

		const row = await db.selectFrom('debate_results').selectAll().where('debate_id', '=', debateId).executeTakeFirst();

		if (!row) {
			return null;
		}

		return this.mapDbRowToResult(row);
	}
}
