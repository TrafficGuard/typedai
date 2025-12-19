import type { DebateList, DebateResult, DebateState } from '#shared/debate/debate.model';

/**
 * Service interface for persisting debate state and results.
 * Implementations: InMemoryDebateStateService, PostgresDebateStateService
 */
export interface DebateStateService {
	/**
	 * Create a new debate
	 * @param state The initial debate state
	 * @returns The created debate state
	 */
	createDebate(state: DebateState): Promise<DebateState>;

	/**
	 * Get a debate by ID
	 * @param debateId The debate ID
	 * @returns The debate state or null if not found
	 */
	getDebate(debateId: string): Promise<DebateState | null>;

	/**
	 * Update an existing debate
	 * @param debateId The debate ID
	 * @param updates Partial updates to apply
	 * @returns The updated debate state
	 */
	updateDebate(debateId: string, updates: Partial<DebateState>): Promise<DebateState>;

	/**
	 * List debates with pagination
	 * @param userId Optional user ID to filter by
	 * @param startAfterId Optional ID for pagination cursor
	 * @param limit Maximum number of results
	 * @returns List of debates with hasMore flag
	 */
	listDebates(userId?: string, startAfterId?: string, limit?: number): Promise<DebateList>;

	/**
	 * Delete a debate by ID
	 * @param debateId The debate ID
	 */
	deleteDebate(debateId: string): Promise<void>;

	/**
	 * Save the final result of a completed debate
	 * @param debateId The debate ID
	 * @param result The debate result
	 */
	saveResult(debateId: string, result: DebateResult): Promise<void>;

	/**
	 * Get the result of a completed debate
	 * @param debateId The debate ID
	 * @returns The debate result or null if not found
	 */
	getResult(debateId: string): Promise<DebateResult | null>;
}
