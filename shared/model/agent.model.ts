import type {FunctionCall, FunctionCallResult, GenerationStats, ImagePartExt, LLM, LlmMessage} from './llm.model';
import type {User} from './user.model';
import {FileMetadata} from "#shared/model/files.model";
import {IFileSystemService} from "#shared/services/fileSystemService";
import {ToolType} from "#shared/services/functions";

/**
 * The difficulty of a LLM generative task. Used to select an appropriate model for the cost vs capability.
 * xeasy  LLama 8b/Flash 8b
 * easy   Haiku 3.5/GPT4-mini/Llama 70b/Gemini Flash
 * medium Sonnet 3.5/GPT4-o/Llama 405b
 * hard   Opus 3.5/OpenAI o1
 * xhard  Ensemble (multi-gen with voting/merging of best answer)
 *
 */
export type TaskLevel = 'easy' | 'medium' | 'hard' | 'xhard';
export type AgentType = 'autonomous' | 'workflow';
export type AutonomousSubType = 'xml' | 'codegen';

export interface AgentTag {
    id?: string;
    title?: string;
}

export interface AgentCompleted {
    notifyCompleted(agentContext: AgentContext): Promise<void>;

    agentCompletedHandlerId(): string;
}

/**
 * workflow - fixed workflow agent running
 * agent - autonomous agent waiting for the agent LLM call(s) to generate control loop update
 * functions - waiting for autonomous agent function call(s) to complete
 * error - the agent has errored or force stopped
 * hil - deprecated for humanInLoop_agent and humanInLoop_tool
 * hitl_threshold - If the agent has reached budget or iteration thresholds. At this point the agent is not executing any LLM/function calls.
 * hitl_tool - When a function has request real-time HITL in the function calling part of the control loop
 * hitl_feedback - the agent has requested human feedback for a decision. At this point the agent is not executing any LLM/function calls.
 * hil - deprecated version of hitl_feedback
 * feedback - deprecated version of hitl_feedback
 * child_agents - stopped waiting for child agents to complete
 * completed - the agent has called the completed function.
 * shutdown - if the agent has stopped after being instructed by the system to pause (e.g. for server shutdown)
 * timeout - for chat agents when there hasn't been a user input for a configured amount of time
 */
export type AgentRunningState =
    | 'workflow'
    | 'agent'
    | 'functions'
    | 'error'
    | 'hil'
    | 'hitl_threshold'
    | 'hitl_tool'
    | 'hitl_feedback'
    | 'completed'
    | 'shutdown'
    | 'child_agents'
    | 'timeout';

/**
 * @param agent
 * @returns if the agent has a live execution thread
 */
export function isExecuting(agent: AgentContext): boolean {
    return agent.state === 'workflow' || agent.state === 'agent' || agent.state === 'functions' || agent.state === 'hitl_tool';
}

/**
 * The LLMs for each Task Level
 */
export type AgentLLMs = Record<TaskLevel, LLM>;

/**
 * The state of an agent.
 * Ensure any new fields are handled in agentSerialization.ts
 */
export interface AgentContext {
    /** Primary Key - Agent instance id. Allocated when the agent is first starts */
    agentId: string;
    /** The type of agent (autonomous or workflow) */
    type: AgentType;
    subtype: AutonomousSubType | string;
    /** Child agent ids */
    childAgents?: string[];
    /** Id of the running execution. This changes after the agent restarts due to an error, pausing, human in loop, completion etc */
    executionId: string;
    /** The path to the TypedAI repo. i.e. TYPEDAI_HOME env variable or process.cwd() of the most recent execution. If the agent re-starts on a machine with a different value then the file system working directory can be updated. */
    typedAiRepoDir: string;
    /** Current OpenTelemetry traceId */
    traceId: string;
    /** Display name */
    name: string;
    /** Not used yet */
    /** The VibeSession this agent belongs to, if any */
    parentAgentId?: string;
    vibeSessionId?: string;
    /** The user who created the agent */
    user: User;
    /** The current state of the agent */
    state: AgentRunningState;
    /** Tracks what functions/spans we've called into */
    callStack: string[];
    /** Error message & stack */
    error?: string;
    output?: string;
    /** Budget spend in $USD until a human-in-the-loop is required */
    hilBudget: number;
    /** Total cost of running this agent */
    cost: number;
    /** Budget remaining until human intervention is required */
    budgetRemaining: number;
    /** Pre-configured LLMs by task difficulty level for the agent. Specific LLMs can always be instantiated if required. */
    llms: AgentLLMs;
    /** Working filesystem */
    fileSystem?: IFileSystemService | null;
    /** Determines if repositories should be cloned into a shared location (true) or the agent's private directory (false). Defaults to true. */
    useSharedRepos: boolean;
    /** Memory persisted over the agent's executions */
    memory: Record<string, string>;
    /** Time of the last database write of the state */
    lastUpdate: number;
    /** Agent custom fields */
    metadata: Record<string, any>;

    /** The functions available to the agent */
    functions: LlmFunctions;
    completedHandler?: AgentCompleted;

    // ChatBot properties ----------------

    /** Messages sent by users while the agent is still processing the last message */
    pendingMessages: string[];

    // Autonomous agent specific properties --------------------
    /** The number of completed iterations of the agent control loop */
    iterations: number;
    /** The function calls the agent is about to call (xml only) */
    invoking: FunctionCall[];
    /** Additional notes that tool functions can add to the response to the agent */
    notes: string[];
    /** The initial prompt provided by the user or parent agent */
    userPrompt: string;
    /** The prompt the agent execution started/resumed with for codeGen/XML agent */
    inputPrompt: string;
    /** The message the agent execution started/resumed with for cachingCodeGen agent */
    messages: LlmMessage[];
    /** Completed function calls with success/error output */
    functionCallHistory: FunctionCallResult[];
    /** How many iterations of the autonomous agent control loop to require human input to continue */
    hilCount;
    /** If the user has requested a human-in-the-loop intervention after the current control loop iteration completes */
    hilRequested?: boolean;
    /** Files which are always provided in the agent control loop prompt */
    liveFiles?: string[];
    fileStore?: FileMetadata[];
    /** The latest state of tools, updated at the end of each iteration */
    toolState?: Record<string, any>;
}

/**
 * For autonomous agents we save details of each control loop iteration
 * Keep in sync with frontend/src/app/modules/agents/agent.types.ts
 */
export interface AutonomousIteration {
    agentId: string;
    /** Starts from 1 */
    iteration: number;
    /** The LLM and other costs for this iteration */
    cost: number;
    /** A summary of what was done/attempted */
    summary: string;
    /** The function class names available */
    functions: string[];
    /** The input prompt */
    prompt: string;
    /** Images included with the input prompt */
    images: ImagePartExt[];
    /** Extracted from <expanded_user_request></expanded_user_request>*/
    expandedUserRequest: string;
    /** Extracted from <observations-reasoning> */
    observationsReasoning: string;
    /** Generated agent plan extracted from <plan></plan> */
    agentPlan: string;
    /** Extracted from <next_step_details></next_step_details> */
    nextStepDetails: string;
    /** Initial generated code */
    draftCode: string;
    /** Self review of the code */
    codeReview: string;
    /** Generated code, after review (for code gen agents extracted from <python-code></python-code>) */
    code: string;
    /** The full script which was executed */
    executedCode: string;
    /** Function calls executed this iteration */
    functionCalls: FunctionCallResult[];
    /** The memory contents at the end of the iteration */
    memory: Map<string, string>;
    /** Tool state, LiveFile's, FileStore etc. Class name as the key */
    toolState: Map<string, any>;
    /** Any error */
    error?: string;
    /** Plan generation stats */
    stats: GenerationStats;
    /** Files which are always provided in the agent control loop prompt */
    liveFiles?: string[];
    /** Metadata of files in the agent's filestore at the end of the iteration */
    // fileStore?: FileMetadata[];
}



export interface LlmFunctions {
    toJSON(): { functionClasses: string[] };

    fromJSON(obj: any): this;

    removeFunctionClass(functionClassName: string): void;

    getFunctionInstances(): Array<object>;

    getFunctionInstanceMap(): Record<string, object>;

    getFunctionClassNames(): string[];

    getFunctionType(type: ToolType): any;

    addFunctionInstance(functionClassInstance: object, name: string): void;

    addFunctionClass(...functionClasses: Array<new () => any>): void;

    callFunction(functionCall: FunctionCall): Promise<any>;
}