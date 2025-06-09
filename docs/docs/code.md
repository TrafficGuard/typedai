# Coding Agents

## High level usage

TypedAI comes with 3 main entry points for coding agents.

- **code** - Edits a local repository
- **swe** - Ticket-to-merge-request workflow
- **codeAgent** - Autonomous agent pre-configured for coding tasks with preset functions and prompt postfix.

Additionally, **agent** is the general purpose autonomous agent which can be configured for coding tasks.

### Code

The low-level coding agent used by the other agents is the CodeEditingAgent.

This uses the selectFilesAgent to search through the codebase to develop and implementation plan.
The `SearchReplaceCoder` then generates search/replace blocks, in the same format as Aider, to edit the files.

Usage:

`ai code 'Update the user profile page to include the new default chat LLM field'`

### SWE

The SWE workflow 
- Search through the projects in GitHub or GitLab to find the relevant project to clone and branch
- Performs the edit/compile/list/test loop via `CodeEditingAgent`
- Creates a merge request

Usage:

`ai swe 'Complete Jira ABC-123'`

### Code Agent

The code agent is an autonomous agent pre-configured for coding tasks with preset functions and prompt postfix.

`ai codeAgent 'The user functionality has been updated to use the new design described in DOCS.md. Go through each other module and refactor to the new design'`

## Supporting Workflow Agents

## Index repository

For enhanced codebase navigation this agent generates short summaries of each file and folder.

The generated summaries are saved to `.typedai/docs`

To have the summaries generated you can either:

Run the agent manually by running:

`ai index`

or add to the project config file `.typedai.json` the array property 'indexDocs'. 

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

These details are stored in the file `.typedai.json`




