import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import type { LlmCall } from '#shared/model/llmCall.model';

export interface CallerId {
	agentId?: string;
	userId?: string;
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
}
