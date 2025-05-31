import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import type { LlmCall, LlmCallSummary } from '#shared/llmCall/llmCall.model';
import { Db } from 'mongodb';

export class MongoLlmCallService implements LlmCallService {
	constructor(private db: Db) {}

	async saveRequest(request: CreateLlmRequest): Promise<LlmCall> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async saveResponse(llmCall: LlmCall): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getCall(llmCallId: string): Promise<LlmCall | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getLlmCallsForAgent(agentId: string, limit?: number): Promise<LlmCall[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getLlmCallsByDescription(description: string, agentId?: string, limit?: number): Promise<LlmCall[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async delete(llmCallId: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getLlmCallSummaries(agentId: string): Promise<LlmCallSummary[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getLlmCallDetail(llmCallId: string): Promise<LlmCall | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}
}
