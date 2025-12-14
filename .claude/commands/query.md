---
description: Ask questions about a repository/codebase and get detailed answers with file citations
---

# Query

Ask natural language questions about a codebase and receive detailed answers with citations to specific files. The agent iteratively searches and reads files to gather context before generating a comprehensive answer.

## How It Works

The query agent:
1. Analyzes the repository structure to understand the codebase
2. Searches for relevant files using regex and/or vector search
3. Reads and inspects files that might contain answers
4. Synthesizes information and generates a detailed answer
5. Includes citations to files where information was found
6. Returns the list of files that were analyzed

## Usage

```bash
query "How does the authentication system work?"

# Complex query with hard LLM (more thorough)
query -h "Explain the complete data flow from API request to database response"

# With initial files to include in context
query --initial-files=src/auth.ts,src/middleware.ts "How does this authentication flow work?"
```

**Flags:**
- `-h`: Use hard LLM for complex queries (slower but more thorough)
- `--initial-files=file1,file2`: Comma-separated list of initial files to include in context
- `-r`: Resume from previous agent run

## Output Format

Returns a detailed text answer with:
- Comprehensive explanation answering the query
- Citations to specific files where information was found
- List of all files that were analyzed
- Confidence level indicator

## Example Queries

**Architecture & Design:**
- "What is the overall architecture of this application?"
- "What design patterns are used in the codebase?"

**Implementation Details:**
- "How does the caching mechanism work?"
- "Where is error handling implemented?"

**Debugging:**
- "Where would authentication failures be logged?"
- "What happens when a database connection fails?"


## Notes
- Uses multiple search strategies (file system tree with per-file summaries, regex and vector search if available)
