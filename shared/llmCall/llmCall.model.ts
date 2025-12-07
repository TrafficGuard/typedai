import type { CallSettings, LlmCallMessageSummaryPart, LlmMessage } from '../llm/llm.model';

export interface LlmRequest {
	/** UUID */
	id: string;
	/** From the GenerateTextOptions.id field */
	description?: string;

	messages: LlmMessage[];
	/** Temperature, topK etc */
	settings: CallSettings;
	/** Populated when called by an agent */
	agentId?: string;
	/** Iteration of an autonomous agent */
	iteration?: number;
	/** Populated when called by a user through the UI */
	userId?: string;
	callStack?: string;
	/** LLM service/model identifier */
	llmId: string;
	/** Time of the LLM request */
	requestTime: number;

	/** Internal ID used for linking chunks in Firestore due to maximum doc size limits. Matches the first chunk id. Ideally remove from the public interface as it's an implementation detail */
	llmCallId?: string;
}

// New fields need to be added in FirestoreLlmCallService.getLlmResponsesByAgentId
export interface LlmCall extends LlmRequest {
	/** Duration in millis until the first response from the LLM */
	timeToFirstToken?: number;
	/** Duration in millis for the full response */
	totalTime?: number;
	/** Cost in $USD */
	cost?: number;
	inputTokens?: number;
	outputTokens?: number;
	/** Notification if the response was not in the format expected by the prompt, i.e. couldn't parse the result or json tag */
	warning?: string;
	/** If there was a provider or network error */
	error?: string;

	/** Number of chunks the messages are split into (0 if not chunked). Specific to Firestore. Ideally remove from the public interface */
	chunkCount?: number;

	// === Evaluation Metrics ===
	/** Number of input tokens served from cache */
	cachedInputTokens?: number;
	/** Number of tokens used for extended thinking/reasoning */
	reasoningTokens?: number;
	/** Why the generation stopped (stop, length, tool_calls, content_filter) */
	finishReason?: string;
	/** Number of retry attempts for this call */
	retryCount?: number;
	/** Whether the expected structure was successfully extracted from response */
	extractionSuccess?: boolean;
	/** Identifier for the prompt template used */
	promptTemplateId?: string;
	/** Post-hoc quality assessment score (0-1) */
	responseQualityScore?: number;
	/** How well the response adhered to instructions (0-1) */
	instructionAdherence?: number;
}

export interface LlmCallSummary {
	id: string;
	description?: string;
	llmId: string;
	requestTime: number;
	totalTime?: number;
	inputTokens?: number;
	outputTokens?: number;
	cost?: number;
	error?: boolean;
	callStack?: string;
	messageSummaries: LlmCallMessageSummaryPart[];
	// Evaluation metrics for summary view
	cachedInputTokens?: number;
	extractionSuccess?: boolean;
	finishReason?: string;
}

/**
 * Aggregate metrics for a set of LLM calls (e.g., for an iteration or task)
 */
export interface LlmCallMetricsAggregate {
	/** Total number of LLM calls */
	callCount: number;
	/** Total cost across all calls */
	totalCost: number;
	/** Total input tokens */
	totalInputTokens: number;
	/** Total output tokens */
	totalOutputTokens: number;
	/** Total cached input tokens */
	totalCachedTokens: number;
	/** Ratio of cached tokens to total input tokens (0-1) */
	cacheHitRatio: number;
	/** Total reasoning/thinking tokens */
	totalReasoningTokens: number;
	/** Average time to first token (ms) */
	avgTimeToFirstToken: number;
	/** Average total time (ms) */
	avgTotalTime: number;
	/** Number of calls with extraction failures */
	extractionFailures: number;
	/** Number of calls with errors */
	errorCount: number;
	/** Number of retries across all calls */
	totalRetries: number;
}
