import { LlmFunctions } from '#agent/LlmFunctions';
import type { AgentContext, AgentRunningState } from '#agent/agentContextTypes';
import { deserializeAgentContext, serializeContext } from '#agent/agentSerialization';
import type { AgentStateService } from '#agent/agentStateService/agentStateService';
import { functionFactory } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';

/**
 * In-memory implementation of AgentStateService for tests. Serializes/deserializes
 * to behave the same as the FireStore implementation
 */
export class InMemoryAgentStateService implements AgentStateService {
	stateMap: Map<string, Record<string, any>> = new Map();

	clear(): void {
		this.stateMap.clear();
	}

	async save(state: AgentContext): Promise<void> {
		state.lastUpdate = Date.now();
		const serialized = serializeContext(state);
		this.stateMap.set(state.agentId, serialized);
	}

	async updateState(ctx: AgentContext, state: AgentRunningState): Promise<void> {
		ctx.state = state;
		await this.save(ctx);
	}

	async load(executionId: string): Promise<AgentContext> {
		if (!this.stateMap.has(executionId)) throw new Error('Agent state not found');
		const serialized = this.stateMap.get(executionId);
		return await deserializeAgentContext(serialized);
	}

	async list(): Promise<AgentContext[]> {
		const serializedList = Array.from(this.stateMap.values());
		return Promise.all(serializedList.map(deserializeAgentContext));
	}

	async listRunning(): Promise<AgentContext[]> {
		const allAgents = await this.list();
		return allAgents.filter((agent) => agent.state !== 'completed');
	}

	async delete(ids: string[]): Promise<void> {
		for (const id of ids) this.stateMap.delete(id);
	}

	async updateFunctions(agentId: string, functions: string[]): Promise<void> {
		const agent = await this.load(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		agent.functions = new LlmFunctions();
		for (const functionName of functions) {
			const FunctionClass = functionFactory()[functionName];
			if (FunctionClass) {
				agent.functions.addFunctionClass(FunctionClass);
			} else {
				logger.warn(`Function ${functionName} not found in function factory`);
			}
		}

		await this.save(agent);
	}
}
