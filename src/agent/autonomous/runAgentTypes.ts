import type { AgentCompleted, AgentLLMs, AgentType, LlmFunctions } from '#shared/agent/agent.model';
import type { User } from '#shared/user/user.model';

export type RunWorkflowConfig = Omit<RunAgentConfig, 'type' | 'functions'> & Partial<Pick<RunAgentConfig, 'functions'>>;

/**
 * Configuration for running an autonomous agent
 */
export interface RunAgentConfig {
	/** The user who created the agent. Uses currentUser() if not provided */
	user?: User;
	/** The parent agentId */
	parentAgentId?: string;
	codeTaskId?: string;
	/** The name of this agent */
	agentName: string;
	/** Autonomous or workflow */
	type: AgentType;
	/** For autonomous agents either xml or codegen. For workflow agents it identifies the workflow type */
	subtype: string;
	/** The function classes the agent has available to call */
	functions: LlmFunctions | Array<new () => any>;
	/** Handler for when the agent finishes executing. Defaults to console output */
	completedHandler?: AgentCompleted;
	/** The user prompt */
	initialPrompt: string;
	/** The agent system prompt */
	systemPrompt?: string;
	/** Settings for requiring a human-in-the-loop */
	humanInLoop?: { budget?: number; count?: number; functionErrorCount?: number };
	/** The default LLMs available to use */
	llms?: AgentLLMs;
	/** The agent to resume */
	resumeAgentId?: string;
	/** The base path of the context FileSystem. Defaults to the process working directory */
	fileSystemPath?: string;
	/** Use shared repository location instead of agent-specific directory. Defaults to true. */
	useSharedRepos?: boolean;
	/** If running in a container, the ID of the container */
	containerId?: string;
	/** Additional details for the agent */
	metadata?: Record<string, any>;
	/** Initial memory entries */
	initialMemory?: Record<string, string>;
}
