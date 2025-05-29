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
}
