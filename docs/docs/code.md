# Coding Agents Quickstart

TypedAI provided agentic coding agents, similar to Claude Code, Cursor Agent mode, OpenAI Codex, Devin, etc.

There are 3 main entry points for coding agents.

- **code** - Edits a local repository
- **swe** - Ticket-to-merge-request workflow
- **codeAgent** - An advanced CodeAct autonomous agent pre-configured for coding tasks with preset functions and prompt postfix.

Additionally, **agent** is the general purpose autonomous agent which can be used for coding tasks requiring more custom tool selection etc.

These agents have package.json scripts which can be run using `npm run <type> <prompt>` or `ai <type> <prompt>`

We recommend using `ai` over `npm run` as:

- `ai` doesn't require add `--` before arguments.
- `ai` allows you to run the agents in repositories outside the TypedAI repository.



## Code

CodeEditingAgent is the low-level coding agent used by the other agents.

This uses the `selectFilesAgent` to search through the codebase to generate an implementation plan.
The `SearchReplaceCoder` then generates search/replace blocks, in the same format as Aider, to edit the files.

Example usage:

`ai code 'Update the user profile page to include the new default chat LLM field'`

## SWE

The Software Engineer is a requirements/ticket to merge request workflow:

- Search the projects in GitHub/GitLab to find the relevant project to clone and branch
- Performs the edit/compile/list/test loop via `CodeEditingAgent`
- Creates a merge request

Example usage:

`ai swe 'Complete Jira ABC-123'`

## Code Agent

The code agent is an autonomous agent pre-configured for coding tasks with preset functions and prompt postfix to help guide the agent over longer tasks.

Example usage:

`ai codeAgent 'The user functionality has been updated to use the new design described in DOCS.md. Go through each other module and refactor to the new design'`

## Supporting Workflow Agents & Configuration

## Index repository agent

For enhanced codebase navigation this agent generates short summaries of each file and folder. These summaries are displayed alongside each file in the FileSystemTree

The generated summaries are saved to `.typedai/docs`, which can be done two ways.

1. Generate the summaries manually by running:
`ai index`

2. Have them automatically generated/updated. This requires adding the array property `indexDocs` to the project config file `.typedai.json` . 

For example:

```json
[{
  "baseDir": "./",
  "language": "typescript",
  "initialise": "npm install",
  "compile": "npm run build",
  "format": "",
  "staticAnalysis": "npm run lint",
  "test": "npm run test",
  "languageTools": "typescript",
  "devBranch": "main",
  "indexDocs": [
    "src/**/*.ts"
  ]
}]
```

## Query/File Selection

This agent performs the key task of identifying the set of files for the code editing agent, based on the user's query/requirements.

This automatically includes any rules files for AI tools such as Cursor, Windsurf, Aider and Codex. Added to the selection is any `DOCS.md` files
in the folders, or parent folders, of the selected files.

## Project detection

Utilising the Query/File Selection agent, this workflow detects the projects in a repository, and the project initialisation, compile, lint, and test commands.

These details are saved to the file `.typedai.json` to allow for future reference.




