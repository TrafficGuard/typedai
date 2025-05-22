import { randomUUID } from 'node:crypto';
import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import { CallerId, type LlmCallService } from '#llm/llmCallService/llmCallService';
import { type LlmCall, LlmRequest } from '#shared/model/llmCall.model';

export class InMemoryLlmCallService implements LlmCallService {
	llmCallStore = new Map<string, LlmCall>();

	async getCall(llmCallId: string): Promise<LlmCall | null> {
		return this.llmCallStore.get(llmCallId) || null;
	}

	async getLlmCallsForAgent(agentId: string): Promise<LlmCall[]> {
		return Array.from(this.llmCallStore.values()).filter((call) => call.agentId === agentId);
	}

	async saveRequest(request: CreateLlmRequest): Promise<LlmCall> {
		const id = randomUUID();
		const requestTime = Date.now();
		const llmCall: LlmCall = {
			id,
			...request,
			requestTime,
		};
		this.llmCallStore.set(id, llmCall);
		return llmCall;
	}

	async saveResponse(llmCall: LlmCall): Promise<void> {
		this.llmCallStore.set(llmCall.id, llmCall);
	}

	getLlmCallsByDescription(description: string): Promise<LlmCall[]> {
		return Promise.resolve(Array.from(this.llmCallStore.values()).filter((llmCall) => llmCall.description === description));
	}

	async delete(llmCallId: string): Promise<void> {
		this.llmCallStore.delete(llmCallId);
	}
}
