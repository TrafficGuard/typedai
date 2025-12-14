---
description: Generate a file tree with summaries, collapsing irrelevant folders for a given task
---

# File Tree

Generate a file system tree with folder and file summaries. Optionally collapse folders not relevant to a specific query.

## How It Works

The file-tree tool:
1. Loads pre-generated summaries for all folders and files (from `.typedai/docs/`)
2. If a query is provided, uses an LLM to determine which folders are not relevant
3. Generates a tree view with irrelevant folders collapsed
4. Shows folder/file summaries inline for quick understanding

## Usage

```bash
# Show full tree with all file summaries
file-tree

# Collapse folders not relevant to a query
file-tree "Find authentication implementation"
```

## Output Format

Returns a text tree with folder/file summaries:

```
src/  Authentication and API implementation

src/auth/  User authentication and session management
    auth.ts  Main authentication logic with JWT support
    session.ts  Session management and token refresh

src/api/  REST API endpoints
    routes.ts  Route definitions
    handlers.ts  Request handlers

tests/ (collapsed)  Test suites

docs/ (collapsed)  Documentation files
```

Collapsed folders show only the folder name and summary, hiding their contents.

## Prerequisites

The repository must be indexed first to generate summaries:

```bash
ai summaries sync
```

Without indexing, the tree will show the structure but without summaries.

## Notes

- Collapse decisions are conservative - when in doubt, folders stay visible
- Works best with indexed repositories that have generated summaries
