# AI Coding Agents

The TypedAI software/coding agents perform patch editing of files to implement requirements, with multiple supporting agent workflows.

## Code Editing Agent

The [Code Editor Agent](https://github.com/TrafficGuard/typedai/blob/main/src/swe/codeEditingAgent.ts) is used for editing local repositories. It was the 'bootstrap' agent to help accelerate the development of this platform.

### Workflow

- Detects the project init/compile/lint/test commands (if not provided in the constructor)
- Selects the relevant files to edit and other supporting files.
- Creates an implementation plan from the input requirements and analysing the current code.
- Run a edit/compile/lint/test cycle
    - Calls the Search/Replace coder with the implementation plan and file list.
    - Runs compile, format, lint, test targets auto-detected from project configuration.
    - On compile/lint/test errors the agent may:
        - Perform online research to assist with fixing errors (Requires Perplexity configured).
        - Install missing packages.
        - Add additional files to the context.
        - Analyse the diff since the last successfully compiled commit.

### FileSystem

The agent context has a FileSystem, which defaults to the TypedAI project directory. If you want to use the code editing agent
on another local repo then the options are:

- Use the `ai` script described in the [CLI](cli.md) documentation.
- Set the TYPEDAI_FS environment variable to the repository path before running a command to start an agent.
- In a custom agent/workflow set the `RunAgentConfig.fileSystemPath` property on a new agent.

### Project Info

Before the agent can perform the code/test/lint loop it needs to know the commands to run, and also to initialise the project.

The agent searches through the files to find the commands and then saves it to the file `.typedai.json` for re-use.

If the agent makes a mistake in the detection then manually edit the `.typedai.json` file.

### Language Tools
 
TypedAI aims to be a flexible platform, and one example is the language specific tooling. The project detection also detects which language a project uses.

The initial `LanguageTools` interface has the `generateProjectMap`, `getInstalledPackages` and `installPackage` methods.

For example, the TypeScript `generateProjectMap` implementation runs `tsc` with the `emitDeclarationOnly` flag. This produces a smaller set of text for the LLM to search through, compared to the original source files.


## Software Developer Agent

The [Software Developer Agent](https://github.com/TrafficGuard/typedai/blob/main/src/swe/softwareDeveloperAgent.ts) is designed to automate tasks in environments with multiple repositories, making it suitable for enterprise environments. 

### Workflow

The current workflow is:

- Summarise/re-write the requirements (useful when the input is a Jira issue etc.)
- Searches projects in your code management tool (GitLab, GitHub) for the relevant project.
- Clones the project and create a branch.
- Detects how to initialise, compile, test and lint the project.
- Initialises the project
- Calls the Code Editor Agent with the requirements and project info.
- Creates a merge/pull request title and description.
- Pushes to Git server and raises a merge/pull request.


## Flexibility and Extensibility

The agents are designed with modularity and adaptability in mind:

- The high-level workflow is abstracted through a SourceCodeManagement interface, allowing for easy integration with various SCM systems.
- The Code Editing workflow is encapsulated as a separate agent, enabling its use in standalone local repository editing scenarios or integration into alternative Software Engineer agents with custom workflows.
- Language specific tooling for code search/retrieval augmented generation and safe operations.

## The Future - Applying Metacognition

This is only the very beginning of the agent workflows and their coding capabilities. We have a many ideas to experiment with to increase the ability of the agents to complete useful work.

Metacognition is the awareness and understanding of one's own thought processes. It involves thinking about thinking, or reflecting on one's cognitive processes.

As experienced software engineers our thoughts processes are able to quickly draw on our tacit knowledge - the intuitive, experience-based knowledge that can be difficult to express or document formally, when designing, implementing and debugging a solution.

This knowledge covers many topics such as code smell detection, language features, architectural intuition, debugging instincts, technical debt awareness, tool selection, code organization, performance optimizations, and security considerations.

In the context of learning and problem-solving for LLMs, metacognition includes planning how to approach a task, monitoring comprehension, and evaluating progress.

- Task analysis: Carefully considering what you want the LLM to do and breaking it down into components.
- Strategic planning: Designing prompts that guide the LLM through a logical thought process.
- Self-monitoring: Analyzing the LLM's responses to see if they meet the intended goals.
- Adjustment: Refining prompts based on the LLM's output to improve results.
- Reflection: Considering why certain prompts work better than others and learning from this.
- Awareness of model limitations: Understanding what the LLM can and cannot do, and designing prompts and workflows accordingly.
- Explicit instruction: Incorporating metacognitive strategies directly into prompts, asking the LLM to explain its reasoning or check its work.

We accept that asking the LLM to get it right the first go is as absurd as asking you to write the solution from start to finish without any edits.

Then it follows we need to replicate our own thought process as workflows that routes between prompts and RAG solutions for the step of the task at hand.

<!--
## AI-editing friendly code

There are some suggestions to follow to writing code that is amendable to AI editing.

TypeScript 5.5 introduced a new compiler option called [Isolated Declarations](https://devblogs.microsoft.com/typescript/announcing-typescript-5-5/#isolated-declarations)
-->