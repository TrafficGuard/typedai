import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import type { AgentContext, AgentContextPreview, AgentRunningState, AutonomousIteration, AutonomousIterationSummary } from '#shared/agent/agent.model';

export class MongoAgentContextService implements AgentContextService {
	async save(state: AgentContext): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async updateState(ctx: AgentContext, state: AgentRunningState): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async load(agentId: string): Promise<AgentContext | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async requestHumanInLoopCheck(agent: AgentContext): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async list(): Promise<AgentContextPreview[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async listRunning(): Promise<AgentContextPreview[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	clear(): void {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async delete(ids: string[]): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async updateFunctions(agentId: string, functions: string[]): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async saveIteration(iterationData: AutonomousIteration): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async loadIterations(agentId: string): Promise<AutonomousIteration[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getAgentIterationSummaries(agentId: string): Promise<AutonomousIterationSummary[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getAgentIterationDetail(agentId: string, iterationNumber: number): Promise<AutonomousIteration | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}
}
