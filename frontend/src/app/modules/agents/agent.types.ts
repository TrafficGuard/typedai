export interface AgentPagination {
    length: number;
    size: number;
    page: number;
    lastPage: number;
    startIndex: number;
    endIndex: number;
}

export interface AgentType {
    id: string;
    parentId: string;
    name: string;
    slug: string;
}

export interface AgentTag {
    id?: string;
    title?: string;
}


export type TaskLevel = 'easy' | 'medium' | 'hard' | 'xhard';

interface LLM {
    /**
     * The LLM model identifier
     */
    getModel(): string;

    getService(): string;
}

/**
 * The LLMs for each Task Level
 */
export type AgentLLMs = Record<TaskLevel, LLM>;

export interface FunctionCall {
    function_name: string;
    parameters: { [key: string]: any };
}

export interface FunctionCallResult extends FunctionCall {
    stdout?: string;
    stderr?: string;

    stdoutExpanded: boolean;
    stdoutSummary?: string;
    stderrExpanded: boolean;
    stderrSummary?: string;
}

/**
 * agent - waiting for the agent LLM call(s) to generate control loop update
 * functions - waiting for the planned function call(s) to complete
 * error - the agent control loop has errored
 * hil - deprecated for humanInLoop_agent and humanInLoop_tool
 * hitl_threshold - If the agent has reached budget or iteration thresholds. At this point the agent is not executing any LLM/function calls.
 * hitl_tool - When a function has request HITL in the function calling part of the control loop
 * hitl_feedback - the agent has requested human feedback for a decision. At this point the agent is not executing any LLM/function calls.
 * hil - deprecated version of hitl_feedback
 * feedback - deprecated version of hitl_feedback
 * child_agents - waiting for child agents to complete
 * completed - the agent has called the completed function.
 * shutdown - if the agent has been instructed by the system to pause (e.g. for server shutdown)
 * timeout - for chat agents when there hasn't been a user input for a configured amount of time
 */
export type AgentRunningState =
    | 'agent'
    | 'functions'
    | 'error'
    | 'hil'
    | 'hitl_threshold'
    | 'hitl_tool'
    | 'feedback'
    | 'hitl_feedback'
    | 'completed'
    | 'shutdown'
    | 'child_agents'
    | 'timeout';

export interface AgentContext {
    /** Agent instance id - allocated when the agent is first starts */
    agentId: string;
    /** Id of the running execution. This changes after the control loop restarts after an exit due to pausing, human in loop etc */
    executionId: string;
    traceId: string;
    name: string;
    parentAgentId?: string;
    isRetry: boolean;
    /** Empty string in single-user mode */
    userId: string;
    userEmail?: string;
    type: AgentType;
    state: AgentRunningState;
    inputPrompt: string;
    userPrompt: string;
    systemPrompt: string;
    functionCallHistory: FunctionCallResult[];

    // These three fields are mutable for when saving state as the agent does work
    error?: string;
    planningResponse?: string;
    invoking: FunctionCall[];
    /** Total cost of running this agent */
    cost: number;
    /** Budget allocated until human intervention is required. This may be increased when the agent is running */
    budget: number;
    /** Budget remaining until human intervention is required */
    budgetRemaining: number;

    llms: { easy: string; medium: string; hard: string; xhard: string };

    /** Working filesystem */
    fileSystem: { workingDirectory: string };
    /** The functions available to the agent */
    functions: string[];
    /** Memory persisted over the agent's control loop iterations */
    memory: Map<string, string>;

    // UI generated
    output: string;
}

interface TextPart  { type: "text" , text: string }
interface ImagePart { type: "image", image: string | URL, mimeType?: string }
interface FilePart  { type: "file", data: string | URL, mimeType: string }

export interface LlmMessage {
    content: string | Array<TextPart | ImagePart | FilePart>;
    /** The LLM which generated the text (only when role=assistant) */
    llmId?: string;
    /** Set the cache_control flag with Claude models */
    cache?: 'ephemeral';
    /** Time the message was sent */
    time?: number;
}

export interface LlmCall {
    id: string;
    description?: string;
    systemPrompt?: string;
    userPrompt: string;
    messages: LlmMessage[];
    agentId?: string;
    userId?: string;
    callStack?: string;
    llmId: string;
    requestTime: number;
    responseText?: string;
    timeToFirstToken?: number;
    totalTime?: number;
    cost?: number;
    inputTokens: number;
    outputTokens: number;

    systemPromptExpanded: boolean;
    functionCallHistoryExpanded: boolean;
    memoryContentsExpanded: boolean;
    userPromptExpanded: boolean;
    responseTextExpanded: boolean;
}
