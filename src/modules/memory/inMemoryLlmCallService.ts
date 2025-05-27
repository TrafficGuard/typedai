import { randomUUID } from 'node:crypto';
import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import { CallerId, type LlmCallService } from '#llm/llmCallService/llmCallService';
import type { LlmCallMessageSummaryPart, LlmMessage } from '#shared/model/llm.model';
import { type LlmCall, type LlmCallSummary, LlmRequest } from '#shared/model/llmCall.model';

function _createLlmCallMessageSummaries(messages: LlmMessage[] | undefined): LlmCallMessageSummaryPart[] {
	if (!messages || messages.length === 0) return [];
	return messages.map((msg) => {
		let textPreview = '';
		let imageCount = 0;
		let fileCount = 0;

		if (typeof msg.content === 'string') {
			textPreview = msg.content.substring(0, 150);
		} else if (Array.isArray(msg.content)) {
			const textParts: string[] = [];
			for (const part of msg.content) {
				if (part.type === 'text') {
					textParts.push(part.text);
				} else if (part.type === 'image') {
					imageCount++;
				} else if (part.type === 'file') {
					fileCount++;
				}
			}
			textPreview = textParts.join(' ').substring(0, 150);
		}
		return {
			role: msg.role,
			textPreview,
			imageCount,
			fileCount,
		};
	});
}

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
		let calls = Array.from(this.llmCallStore.values()).filter((llmCall) => llmCall.description === description);

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

	async getLlmCallSummaries(agentId: string): Promise<LlmCallSummary[]> {
		const summaries: LlmCallSummary[] = [];
		for (const call of this.llmCallStore.values()) {
			if (call.agentId === agentId) {
				summaries.push({
					id: call.id,
					description: call.description,
					llmId: call.llmId,
					requestTime: call.requestTime,
					totalTime: call.totalTime,
					inputTokens: call.inputTokens,
					outputTokens: call.outputTokens,
					cost: call.cost,
					error: !!call.error,
					callStack: call.callStack,
					messageSummaries: _createLlmCallMessageSummaries(call.messages),
				});
			}
		}
		// Sort by requestTime descending (newest first)
		return summaries.sort((a, b) => b.requestTime - a.requestTime);
	}

	async getLlmCallDetail(llmCallId: string): Promise<LlmCall | null> {
		return this.getCall(llmCallId);
	}
}
