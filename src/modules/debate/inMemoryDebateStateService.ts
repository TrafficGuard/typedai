import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { DebateList, DebateResult, DebateState } from '#shared/debate/debate.model';
import { NotFound, Unauthorized } from '#shared/errors';
import { currentUser } from '#user/userContext';
import type { DebateStateService } from './debateStateService';

/**
 * In-memory implementation of DebateStateService
 * Used for testing and local development
 */
export class InMemoryDebateStateService implements DebateStateService {
	private debates: Map<string, DebateState> = new Map();
	private results: Map<string, DebateResult> = new Map();

	/**
	 * Create a new debate
	 */
	@span()
	async createDebate(state: DebateState): Promise<DebateState> {
		const userId = currentUser().id;

		if (!state.debateId) {
			throw new Error('Debate ID is required');
		}

		if (this.debates.has(state.debateId)) {
			throw new Error(`Debate with ID ${state.debateId} already exists`);
		}

		const debate: DebateState = {
			...state,
			userId: state.userId ?? userId,
			startTime: state.startTime ?? Date.now(),
		};

		this.debates.set(debate.debateId, structuredClone(debate));
		logger.info(`Created debate ${debate.debateId}`);

		return structuredClone(debate);
	}

	/**
	 * Get a debate by ID
	 */
	@span()
	async getDebate(debateId: string): Promise<DebateState | null> {
		const userId = currentUser().id;
		const debate = this.debates.get(debateId);

		if (!debate) {
			return null;
		}

		// Check authorization - users can only see their own debates
		if (debate.userId && debate.userId !== userId) {
			throw new Unauthorized('Not authorized to view this debate');
		}

		return structuredClone(debate);
	}

	/**
	 * Update an existing debate
	 */
	@span()
	async updateDebate(debateId: string, updates: Partial<DebateState>): Promise<DebateState> {
		const userId = currentUser().id;
		const existing = this.debates.get(debateId);

		if (!existing) {
			throw new NotFound(`Debate with ID ${debateId} not found`);
		}

		if (existing.userId && existing.userId !== userId) {
			throw new Unauthorized('Not authorized to modify this debate');
		}

		const updated: DebateState = {
			...existing,
			...updates,
			debateId: existing.debateId, // Prevent ID changes
			userId: existing.userId, // Preserve owner
		};

		this.debates.set(debateId, structuredClone(updated));
		logger.info(`Updated debate ${debateId}`);

		return structuredClone(updated);
	}

	/**
	 * List debates with pagination
	 */
	@span()
	async listDebates(userId?: string, startAfterId?: string, limit = 50): Promise<DebateList> {
		const currentUserId = userId ?? currentUser().id;

		// Get all debates for the user
		const userDebates = Array.from(this.debates.values())
			.filter((debate) => debate.userId === currentUserId)
			.sort((a, b) => b.startTime - a.startTime); // Sort by startTime desc

		// Find the starting index if startAfterId is provided
		let startIndex = 0;
		if (startAfterId) {
			const startAfterIndex = userDebates.findIndex((debate) => debate.debateId === startAfterId);
			if (startAfterIndex !== -1) {
				startIndex = startAfterIndex + 1;
			}
		}

		// Get the slice of debates
		const debateSlice = userDebates.slice(startIndex, startIndex + limit + 1);
		const hasMore = debateSlice.length > limit;

		const debates = debateSlice.slice(0, limit).map((debate) => structuredClone(debate));

		return { debates, hasMore };
	}

	/**
	 * Delete a debate
	 */
	@span()
	async deleteDebate(debateId: string): Promise<void> {
		const userId = currentUser().id;
		const debate = this.debates.get(debateId);

		if (!debate) {
			throw new NotFound(`Debate with ID ${debateId} not found`);
		}

		if (debate.userId && debate.userId !== userId) {
			throw new Unauthorized('Not authorized to delete this debate');
		}

		this.debates.delete(debateId);
		this.results.delete(debateId); // Also delete associated result
		logger.info(`Deleted debate ${debateId}`);
	}

	/**
	 * Save the final result of a completed debate
	 */
	@span()
	async saveResult(debateId: string, result: DebateResult): Promise<void> {
		const userId = currentUser().id;
		const debate = this.debates.get(debateId);

		if (!debate) {
			throw new NotFound(`Debate with ID ${debateId} not found`);
		}

		if (debate.userId && debate.userId !== userId) {
			throw new Unauthorized('Not authorized to save result for this debate');
		}

		this.results.set(debateId, structuredClone(result));
		logger.info(`Saved result for debate ${debateId}`);
	}

	/**
	 * Get the result of a completed debate
	 */
	@span()
	async getResult(debateId: string): Promise<DebateResult | null> {
		const userId = currentUser().id;
		const debate = this.debates.get(debateId);

		if (!debate) {
			return null;
		}

		if (debate.userId && debate.userId !== userId) {
			throw new Unauthorized('Not authorized to view result for this debate');
		}

		const result = this.results.get(debateId);
		return result ? structuredClone(result) : null;
	}

	/**
	 * Clear all debates from memory
	 * Useful for testing
	 */
	clear(): void {
		this.debates.clear();
		this.results.clear();
	}
}
