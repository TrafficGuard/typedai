import { CreateLlmRequest, LlmCall } from '#llm/llmCallService/llmCall';

export interface CallerId {
	agentId?: string;
	userId?: string;
}

export interface LlmCallService {
	saveRequest(request: CreateLlmRequest): Promise<LlmCall>;

	saveResponse(llmCall: LlmCall): Promise<void>;

	getCall(llmCallId: string): Promise<LlmCall | null>;

	getLlmCallsForAgent(agentId: string): Promise<LlmCall[]>;

	/**
	 * Gets the LLMS calls made by the user for a particular description (The id field in GenerateTextOpts)
	 */
	getLlmCallsByDescription(description: string): Promise<LlmCall[]>;
}
