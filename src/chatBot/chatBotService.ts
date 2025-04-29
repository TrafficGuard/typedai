import { type AgentContext, AgentRunningState } from '#agent/agentContextTypes';

export interface ChatBotService {
	sendMessage(agent: AgentContext, message: string): Promise<void>;
}
