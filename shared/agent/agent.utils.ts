import type { AgentContext } from '#shared/agent/agent.model';
import type { AgentContextPreview } from '#shared/agent/agent.model'; // Import the updated AgentContextPreview

/**
 * Maps a full AgentContext object to a lightweight AgentContextPreview object.
 * @param agent - The full agent context.
 * @returns The agent context preview.
 */
export function toAgentContextPreview(agent: AgentContext): AgentContextPreview {
	return {
		agentId: agent.agentId,
		parentAgentId: agent.parentAgentId,
		name: agent.name,
		type: agent.type,
		subtype: agent.subtype,
		state: agent.state,
		createdAt: agent.createdAt,
		lastUpdate: agent.lastUpdate,
		user: agent.user.id,
		metadata: agent.metadata,
		cost: agent.cost,
		userPrompt: agent.userPrompt,
		inputPrompt: agent.inputPrompt,
		error: agent.error,
	};
}
