import { type AgentContext, AgentRunningState } from '#shared/agent/agent.model';

export interface ChatBotService {
	sendMessage(agent: AgentContext, message: string): Promise<void>;
}
