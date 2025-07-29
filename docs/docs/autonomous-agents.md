# Autonomous AI Agents

TypedAI provides a sophisticated CodeAct autonomous agent which works to complete the user request via a control loop which iteratively (re-)plans and calls the functions available to the agent.

- Reasoning/planning inspired from Google's [Self-Discover](https://arxiv.org/abs/2402.03620) and other papers.
- Memory and function call history for complex workflows.
- Iterative planning with hierarchical task decomposition.
- Generated Python code is executed in a WebAssembly sandbox using Pyodide.
- LLM function schemas auto-generated from source code.
- Human-in-the-loop for budget control, agent initiated questions and error handling.
- Support for dynamically adding images to the agent control loop prompt for analysis.


- The [CodeAct](https://arxiv.org/abs/2402.01030) agent generates Python code. This is executed in a WebAssembly sandbox using Pyodide, which proxies the Python function calls to the JavaScript runtime.

The CodeAct agent has the advantage of being able to perform multiple function calls and perform validation logic,
which can significantly reduce the time and cost of running the agent depending on the tasks.

This custom prompt and parsing allows function calling on any sufficiently capable LLM. However, given the reasoning
capabilities required for optimal plan generation and function selection, the best results will be from using the 
most capable frontier models.

There is also an XML based function calling autonomous agent which returns the desired function call(s) in a custom XML format. This is no longer maintained.

You will also find an experimental CodeAct agent which was refactored to maximize input context caching.

### AgentContext

The `AgentContext` object is the central state-holding entity for an agent's execution. It encapsulates everything an agent needs to know to perform its tasks, including its identity, configuration, current state, history, and available tools. This context is managed through a combination of `AsyncLocalStorage` for in-flight operations and an `AgentContextService` for long-term persistence.

### The `AgentContext` Object and its Properties

The `AgentContext` is defined as a TypeScript interface in `shared/agent/agent.model.ts`. It holds the complete state of an agent instance. Its properties can be grouped as follows:

**1. Identification and Metadata:**

*   `agentId`: A unique identifier for the agent instance, allocated when it first starts.
*   `executionId`: A unique ID for a specific live run of the agent. This changes if the agent is restarted.
*   `name`: A human-readable display name for the agent.
*   `type`: The agent's type, either `'autonomous'` or `'workflow'`.
*   `subtype`: A more specific classification, e.g., `'xml'` or `'codegen'`.
*   `user`: The `User` object associated with the agent.
*   `metadata`: A flexible key-value store for custom data, which can be used to intialise the agent with custom data, or lookup an agent which had handled a particular merge request etc.

**2. State and Execution Control:**

*   `state`: The current `AgentRunningState`, such as `'agent'` (thinking), `'functions'` (executing tools), `'completed'`, or `'error'`.
*   `iterations`: The number of control loop iterations an autonomous agent has completed.
*   `callStack`: An array of strings tracking the functions/spans the agent has called into, useful for debugging.
*   `error`: Stores error information if the agent encounters a problem.

**3. Configuration and Resources:**

*   `llms`: An object (`AgentLLMs`) containing pre-configured Large Language Models for different task difficulties (`easy`, `medium`, `hard`).
*   `functions`: An instance of `LlmFunctions` that provides the agent with access to available tools and functions.
*   `fileSystem`: An instance of `IFileSystemService` for interacting with the file system.
*   `completedHandler`: A handler that is called when the agent successfully completes its task.

**4. History and Data:**

*   `userPrompt`: The initial prompt provided by the user.
*   `messages`: The history of `LlmMessage` objects, crucial for conversational or iterative agents.
*   `functionCallHistory`: A log of all `FunctionCallResult` objects, recording the tools used and their outputs.
*   `memory`: A simple key-value record (`Record<string, string>`) for persisting information across an agent's executions.
*   `toolState`: A record that stores the latest state of tools, updated after each iteration.

**5. Budgeting and Cost Management:**

*   `cost`: The total monetary cost incurred by the agent's execution (e.g., from LLM API calls).
*   `hilBudget` & `hilCount`: Thresholds for budget and iteration count that, when reached, can trigger a "Human-in-the-Loop" (HITL) intervention.

This comprehensive structure is defined in `shared/agent/agent.model.ts`.

### Management via `AsyncLocalStorage`

During an agent's execution, the `AgentContext` is managed using Node.js's `AsyncLocalStorage`. This mechanism provides a way to store data that is scoped to a specific asynchronous execution path, eliminating the need to pass the `context` object as a parameter through every function call.

The implementation is found in `src/agent/agentContextLocalStorage.ts`:

1.  **Storage Initialization**: An `AsyncLocalStorage` instance is created and exported:
    ```typescript
    export const agentContextStorage = new AsyncLocalStorage<AgentContext>();
    ```
    *(Source: `src/agent/agentContextLocalStorage.ts`)*

2.  **Context Creation**: A factory function, `createContext`, is used to build a new `AgentContext` object from a configuration object. This function initializes all the necessary properties with default or provided values.
    ```typescript
    export function createContext(config: RunAgentConfig | RunWorkflowConfig): AgentContext {
        // ... initialization logic
        return {
            agentId: config.resumeAgentId || randomUUID(),
            // ... other properties
        };
    }
    ```
    *(Source: `src/agent/agentContextLocalStorage.ts`)*

3.  **Context Access**: A helper function, `agentContext()`, provides easy access to the context for the current asynchronous scope. Any function within the agent's execution flow can call this to get the full context.
    ```typescript
    export function agentContext(): AgentContext | undefined {
        return agentContextStorage?.getStore();
    }
    ```
    *(Source: `src/agent/agentContextLocalStorage.ts`)*

When an agent process starts, its `AgentContext` is created and then provided to `agentContextStorage.run(context, () => { ... })`. All asynchronous operations within that callback will have access to the same `AgentContext` instance.

### Persistence and Lifecycle Management

While `AsyncLocalStorage` manages the context for a live execution, the `AgentContextService` is responsible for its long-term persistence. This allows an agent's state to be saved, loaded across server restarts, and inspected later.

## Built-in functions

The autonomous agents always have three functions available:

- `Agent_completed`
- `Agent_saveMemory`
- `Agent_deleteMemory`

The `AgentFeedback_requestFeedback` function can also be made available for the agent to request feedback at a particular step.

If you would like to have input at a particular step, then in your prompt ask the model to request feedback at that point.

## Human-in-the-loop

Having a human in the loop is essential for any agent to handle a number of cases:

- **Budget control** - Multiple iterations of calls to frontier LLMs can quickly add up.
- **Guidance** - Keeping the AI on track after a number of control loop iterations.
- **Agent initiated feedback** - Provide details/decisions asked for by the AI
- **Error handling** - Transient errors, configuration errors, balance exceeded errors and more can be fixed and then resume the agent. With some errors you may be able to give the agent guidance for a change in plan, or to research a solution.
- **Verification** - Manually verify function calls that could result in data loss, unwanted modifications etc.

Currently, if the Slack function is available, a message will be sent when a human-in-the-loop event occurs.

When the budget control or control loop iteration thresholds have been reached, then the console will require an `Enter` keypress.

More configuration will be provided soon.

![Agent feedback request](https://public.trafficguard.ai/typedai/feedback.png){ align=left }