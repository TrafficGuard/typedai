# Next generation coding agent

## Conversational agents

CLI coding agent like Claude Code, OpenAI Codex and Gemini CLI are popular with developers, and are great tools for interactive pair-programming with LLMs.

### Pros

Claude is good at asking clarifying questions for the implementation.

Ongoing conversation utilizes context caching

### Cons

Vendor lock-in, use their LLMs unless using a proxy to re-route to other LLMs

Long running jobs require compaction of the context.

A lot of unnecassary tool output and files contets pollutes the context.

LLM's reasoning ability reduces as the context increases.

Claude forgets to follow the initial instructions in CLAUDE.md/AGENTS.md as the context grows.
(Could have a hook which re-injects the CLADE.md after X tokens)
e.g. Writes the code, thinks its done, but hasn't written tests, checked it compiles and tests pass.

Lessons learnt along the way are forgotten

## Next-gen agent

### Leverage specialised models

Utilise specialised models such as MorphLLM Fast Apply

### LLM choices

Select LLMs optimiing for speed, intelligence or cost.

When coding interactively pay extra for fast models/services.
Async tasks can use cheaper models/services.

- Mukti-agent debate with Opus 4.5/Codex 5.1 Max/Gemini 3 Pro for maximum intelligence,
- OpenAI Flex provides high intelligence at low cost
- OpenAI Priority provides high intelligence with reduced latency
- Cerebras provides high speed GLM 4.6
- ZAI provides low cost GLM 4.6

### Codebaese awareness

File summaries (FileSystemTree tool) and vector search for codebase search

### Dedicated search sub-agents

Utilise codebase awareness tools

### Parallel works

Git worktree native parallel tasks.
Use pnpm for lightweight sym linked node_modules 

### Frequenct compaction

When a sub-task completes then compact the conversation

### Background learning extraction

On compact extract learnings from the conversation to add to the knowledge base.


### Optimised common workflows

- Compile, lint, test command with (optional) LLM processing of results to minimize context pollution.
- Branch on sub-task
- Husky hooks enforce commited code must compile.
- When the LLM thinks its done, and ready to merge the branch in, then go to review mode.
    - Code-style
    - Design review - sub-agent searches for general and relevant design guidelines from docs/knowledgebasea and reviews the code in the branch.

### Code-generation for funtion calling

Generate Python code running in Pyodide


### Summarise/extracts from files

When performing a task the agent doesn't always need the full contents of a file in the context window.
The agent should be able to extract only the relevant contents to reduce token count.

Use the MorphLLM way of 
  // existing content...
  <!-- existing content... -->
  # Existing content ...

Even for files that are being edited could be reduced using the MorphLLM existing content tags.

Intent/hope is that mid-level models can do this (GLM 4.6 with ZAI/Cerebras cheap/fast option)

### Autonomous sub-agents

Agent_subAgent(prompt, memoryKeys, files)

### Agent_clarify()

Add a new function to have a standard structured format for clarifying questions so we can generate a UI for it like Claude Code

[{
   "question": "Which Postgres compatible database for the backend?",
   options: ["CloudSQL", "AlloyDB", "Spanner] // freeform "other" always added 
},
{
   "title": "What availability configuration for the deployment",
   question: ["Zonal", "Regional", "Multi-region"] // freeform "other" always added 
}]

## Challenges

### Reduced context caching

Current implementation only caches the system prompt. everything else is a single generated user message in a loop.

Need to look at increasing caching
- Getting the cachingCodeGenAgentRunner.ts up-to-date with codegenAutonomousAgent.ts
- Have multiple turns of responses which compact when a sub-task completes?




src/agent/autonomous/codegen/codegenAutonomousAgent.ts

src/agent/autonomous/codegen/cachingCodeGenAgentRunner.ts

