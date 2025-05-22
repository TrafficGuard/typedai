import { randomUUID } from 'node:crypto';
import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import { CallerId, type LlmCallService } from '#llm/llmCallService/llmCallService';
import { type LlmCall, LlmRequest } from '#shared/model/llmCall.model';

export class InMemoryLlmCallService implements LlmCallService {
	llmCallStore = new Map<string, LlmCall>();

	async getCall(llmCallId: string): Promise<LlmCall | null> {
		return this.llmCallStore.get(llmCallId) || null;
	}

	async getLlmCallsForAgent(agentId: string, limit?: number): Promise<LlmCall[]> {
		const calls = Array.from(this.llmCallStore.values())
			.filter((call) => call.agentId === agentId)
			// Sort by requestTime descending (newest first)
			.sort((a, b) => b.requestTime - a.requestTime);

		return limit ? calls.slice(0, limit) : calls;
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
		if (!this.llmCallStore.has(llmCall.id)) {
			throw new Error(`LlmCall with ID ${llmCall.id} not found, cannot save response.`);
		}
		this.llmCallStore.set(llmCall.id, llmCall);
	}

	async getLlmCallsByDescription(description: string, agentId?: string, limit?: number): Promise<LlmCall[]> {
		let calls = Array.from(this.llmCallStore.values())
			.filter((llmCall) => llmCall.description === description);

		if (agentId) {
			calls = calls.filter((llmCall) => llmCall.agentId === agentId);
		}

		// Sort by requestTime descending (newest first)
		calls.sort((a, b) => b.requestTime - a.requestTime);

		return limit ? calls.slice(0, limit) : calls;
	}

	async delete(llmCallId: string): Promise<void> {
		this.llmCallStore.delete(llmCallId);
	}
}
