import { LlmMessage } from '#llm/llm';

export interface LlmRequest {
	/** UUID */
	id: string;
	/** From the GenerateTextOptions.id field */
	description?: string;

	messages: LlmMessage[] | ReadonlyArray<LlmMessage>;
	/** Populated when called by an agent */
	agentId?: string;
	/** Populated when called by a user through the UI */
	userId?: string;
	callStack?: string;
	/** LLM service/model identifier */
	llmId: string;
	/** Time of the LLM request */
	requestTime: number;
	/** Internal ID used for linking chunks in Firestore due to maximum doc size limits. Matches the first chunk id. */
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
	/** Anthropic context cache stats */
	cacheCreationInputTokens?: number;
	/** Anthropic context cache stats */
	cacheReadInputTokens?: number;
	/** Number of chunks the messages are split into (0 if not chunked). */
	chunkCount?: number;
}

export type CreateLlmRequest = Omit<LlmRequest, 'id' | 'requestTime'>;
