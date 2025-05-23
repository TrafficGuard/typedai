import type { Static } from '@sinclair/typebox';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import { deserializeContext, serializeContext } from '#agent/agentSerialization';
import { functionFactory } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import type { AgentContext, AgentContextPreview, AgentRunningState, AutonomousIteration } from '#shared/model/agent.model';
import type { AgentContextSchema } from '#shared/schemas/agent.schema';

/**
 * In-memory implementation of AgentStateService for tests. Serializes/deserializes
 * to behave the same as the FireStore implementation
 */
export class InMemoryAgentStateService implements AgentContextService {
	// Store in the serialized format
	stateMap: Map<string, Static<typeof AgentContextSchema>> = new Map();
	iterationMap: Map<string, AutonomousIteration[]> = new Map();

	clear(): void {
		this.stateMap.clear();
		this.iterationMap.clear();
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
		const serialized = this.stateMap.get(executionId)!; // Added non-null assertion as we check with .has()
		return deserializeContext(serialized);
	}

	async list(): Promise<AgentContextPreview[]> {
		const serializedList = Array.from(this.stateMap.values());
		const deserializedList: AgentContext[] = serializedList.map((data) => deserializeContext(data));
		const previews: AgentContextPreview[] = deserializedList.map((agent) => ({
			agentId: agent.agentId,
			name: agent.name,
			state: agent.state,
			cost: agent.cost ?? 0,
			error: agent.error,
			lastUpdate: agent.lastUpdate,
			userPrompt: agent.userPrompt,
			inputPrompt: agent.inputPrompt,
			user: agent.user.id, // AgentContext.user is User object, AgentContextPreview.user is string ID
		}));
		return Promise.resolve(previews);
	}

	async listRunning(): Promise<AgentContextPreview[]> {
		const allAgentPreviews = await this.list(); // This will now return AgentContextPreview[]
		const terminalStates: AgentRunningState[] = ['completed', 'shutdown', 'timeout', 'error'];
		return allAgentPreviews.filter((preview) => !terminalStates.includes(preview.state));
	}

	async delete(ids: string[]): Promise<void> {
		for (const id of ids) {
			this.stateMap.delete(id);
			this.iterationMap.delete(id);
		}
	}

	async updateFunctions(agentId: string, functions: string[]): Promise<void> {
		const agent = await this.load(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		agent.functions = new LlmFunctionsImpl();
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

	async loadIterations(agentId: string): Promise<AutonomousIteration[]> {
		return this.iterationMap.get(agentId) || [];
	}

	async saveIteration(iterationData: AutonomousIteration): Promise<void> {
		const iterations = this.iterationMap.get(iterationData.agentId) || [];
		// Ensure iterations are stored in order
		const existingIndex = iterations.findIndex((iter) => iter.iteration === iterationData.iteration);
		if (existingIndex !== -1) {
			iterations[existingIndex] = iterationData; // Update existing iteration
		} else {
			iterations.push(iterationData);
			iterations.sort((a, b) => a.iteration - b.iteration); // Sort by iteration number
		}
		this.iterationMap.set(iterationData.agentId, iterations);
	}

	async requestHumanInLoopCheck(agent: AgentContext): Promise<void> {
		agent.hilRequested = true;
		await this.save(agent);
	}
}
