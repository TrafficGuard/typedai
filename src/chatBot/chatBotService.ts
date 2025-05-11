import { type AgentContext, AgentRunningState } from '#shared/model/agent.model';

export interface ChatBotService {
	sendMessage(agent: AgentContext, message: string): Promise<void>;
}
