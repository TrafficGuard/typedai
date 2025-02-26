# Autonomous AI Agents

- Reasoning/planning inspired from Google's [Self-Discover](https://arxiv.org/abs/2402.03620) and other papers
- Memory and function call history for complex workflows
- Iterative planning with hierarchical task decomposition
- Sandboxed execution of generated code for multi-step function calling and logic
- LLM function schemas auto-generated from source code
- Human-in-the-loop for budget control, agent initiated questions and error handling

TypedAI provides two autonomous agents which work to complete the request via a control loop which iteratively (re-)plans and calls the functions available to the agent.

At a high level they share the same internal state, agent memory, human-in-the loop, functional calling history etc. 

The key difference is:

- The XML agent returns the desired function call(s) in a custom XML format
- The dynamic agent returns Python code. This is executed in a WebAssembly sandbox which has the LLM functions bound to the global scope.

The dynamic agent has the advantage of being able to perform multiple function calls and perform validation logic,
which can significantly reduce the time and cost of running the agent depending on the tasks.

This custom prompt and parsing allows function calling on any sufficiently capable LLM. However, given the reasoning
capabilities required for optimal plan generation and function selection, the best results will be from using the 
most capable frontier models.
Currently, we prefer and recommend using Claude 3.5 Sonnet for the 'hard' LLM which is used by the autonomous agent control loop.

### AgentContext



## Built-in functions

The autonomous agents always have four function available:

- `AgentFeedback_requestFeedback`
- `Agent_completed`
- `Agent_saveMemory`
- `Agent_deleteMemory`

The `requestFeedback` function in the system prompt lets the LLM know it can request a decision or additional details.

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
