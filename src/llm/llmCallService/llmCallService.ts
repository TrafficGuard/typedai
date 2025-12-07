import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import type { LlmCall, LlmCallMetricsAggregate, LlmCallSummary } from '#shared/llmCall/llmCall.model';

export interface CallerId {
	agentId?: string;
	userId?: string;
}

/**
 * Partial metrics that can be updated after a call completes
 */
export interface LlmCallMetricsUpdate {
	extractionSuccess?: boolean;
	promptTemplateId?: string;
	responseQualityScore?: number;
	instructionAdherence?: number;
}

export interface LlmCallService {
	saveRequest(request: CreateLlmRequest): Promise<LlmCall>;

	saveResponse(llmCall: LlmCall): Promise<void>;

	getCall(llmCallId: string): Promise<LlmCall | null>;

	getLlmCallsForAgent(agentId: string, limit?: number): Promise<LlmCall[]>;

	/**
	 * Gets the LLMS calls made by the user for a particular description (The id field in GenerateTextOpts)
	 */
	getLlmCallsByDescription(description: string, agentId?: string, limit?: number): Promise<LlmCall[]>;

	/**
	 * @param llmCallId The ID of the LlmCall to delete.
	 */
	delete(llmCallId: string): Promise<void>;

	/**
	 * Gets summaries of all LLM calls for a given agent.
	 * @param agentId The ID of the agent.
	 * @returns An array of LlmCallSummary objects.
	 */
	getLlmCallSummaries(agentId: string): Promise<LlmCallSummary[]>;

	/**
	 * Gets the detailed data for a specific LLM call.
	 * @param llmCallId The ID of the LLM call.
	 * @returns An LlmCall object or null if not found.
	 */
	getLlmCallDetail(llmCallId: string): Promise<LlmCall | null>;

	// === Evaluation Metrics Methods ===

	/**
	 * Updates evaluation metrics for an existing LLM call.
	 * Used for post-hoc quality assessment.
	 */
	updateMetrics?(llmCallId: string, metrics: LlmCallMetricsUpdate): Promise<void>;

	/**
	 * Gets aggregate metrics for all LLM calls made by an agent.
	 */
	getMetricsForAgent?(agentId: string): Promise<LlmCallMetricsAggregate>;

	/**
	 * Gets aggregate metrics for LLM calls in a specific iteration.
	 */
	getMetricsForIteration?(agentId: string, iteration: number): Promise<LlmCallMetricsAggregate>;
}
