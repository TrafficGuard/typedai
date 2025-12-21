---
description: Select relevant files from a codebase for a given task or requirement
---

# Select Files

Select the minimal set of files from a codebase that are essential for completing a given task. Uses an iterative LLM-driven search with both regex and semantic vector search capabilities.

## How It Works

The select-files agent:
1. Analyzes the repository structure and file summaries
2. Iteratively searches and inspects files using regex and/or vector search
3. Decides which files to keep or ignore based on relevance
4. Returns the minimal set of files needed for the task

## Usage

### Via MCP Tool

If you have the TypedAI MCP server configured, use the `selectFiles` tool:

```json
{
  "workingDirectory": "/path/to/your/project",
  "requirements": "Find all files related to user authentication",
  "initialFilePaths": ["src/auth/index.ts"]  // optional
}
```

**Parameters:**
- `workingDirectory` (required): Absolute path to the project directory
- `requirements` (required): Description of what files are needed and why
- `initialFilePaths` (optional): Array of file paths to include in initial context

### Via CLI

```bash
# Standalone command (recommended)
select-files "Find all files related to user authentication"

# With initial files to include
select-files --initial-files=src/auth/index.ts,src/config.ts "Find related configuration"

# From any directory (uses --fs flag automatically)
cd /path/to/your/project
select-files "Find database models"

# Alternative: via ai wrapper
ai select-files "Find database models"
```

**Flags:**
- `--initial-files=file1,file2`: Comma-separated list of initial files to include
- `-r`: Resume from previous agent run

## Output Format

Returns a JSON array of selected files:

```json
[
  {
    "filePath": "src/auth/authenticate.ts",
    "reason": "Contains the main authentication logic and session management"
  },
  {
    "filePath": "src/config/auth.config.ts",
    "reason": "Authentication configuration including JWT settings"
  }
]
```

**Fields:**
- `filePath`: Relative path to the file from the project root
- `reason`: Explanation of why this file was selected
- `readOnly` (optional): Whether the file should only be read, not modified
- `category` (optional): One of `edit`, `reference`, `style_example`, `unknown`

## Example Requirements

Good requirements are specific and clear:

- "Find files that implement the REST API endpoints for user management"
- "Select all TypeScript files related to database connection and query execution"
- "Find configuration files for authentication and session management"
- "Identify test files for the payment processing module"

## Best Practices

1. **Be Specific**: Include details about the functionality or feature you're looking for
2. **Mention File Types**: If you know the file types (e.g., "TypeScript files"), include that
3. **Reference Features by Name**: Use the actual names of components, functions, or modules
4. **Provide Context**: Explain what task you're trying to accomplish
5. **Use Initial Files**: If you know one relevant file, include it to help focus the search

## Notes

- The agent respects `.gitignore` patterns
- Large files and lock files (like `package-lock.json`) are automatically excluded
- If the repository has been indexed for vector search, semantic queries are also available
- The agent uses prompt caching for efficiency on multiple iterations
