# CLI Usage Guide

## Overview

TypedAI provides powerful command-line interface (CLI) tools that allow you to interact with AI agents and workflows directly from your terminal. The CLI offers several advantages over the web interface:

- **Automation**: Integrate AI workflows into scripts and CI/CD pipelines
- **Efficiency**: Quick access to specific agents without navigating the web UI
- **Flexibility**: Work from any directory with the `ai` and `aid` wrapper scripts
- **Development**: Ideal for code editing, repository analysis, and development tasks

## CLI Wrapper Scripts

TypedAI provides two main wrapper scripts for executing CLI commands:

### `ai` Script (Local Execution)

The `ai` script provides a shortcut for running TypedAI npm scripts with automatic filesystem context.

**Usage:**
```bash
ai <script> [args]
```

**Requirements:**
- `TYPEDAI_HOME` environment variable must be set
- Node.js and fnm installed
- TypedAI repository cloned locally

**Features:**
- Automatically switches to the correct Node.js version using fnm
- Passes `--fs=<current_directory>` to provide filesystem service working directory
- Can be run from any directory
- Uses the local TypedAI installation

**Examples:**
```bash
# Query the current repository
ai query "What test frameworks does this repository use?"

# Run code editing agent
ai code "Add error handling to the user authentication function"

# Start research task
ai research "Latest developments in large language models"
```

### `aid` Script (Docker Execution)

The `aid` script runs TypedAI CLI commands in a Docker container, providing isolation.

**Usage:**
```bash
aid <script> [args]
```

**Requirements:**
- Docker and Docker Compose v2 installed
- `TYPEDAI_HOME` environment variable set

**Features:**
- Creates dynamic docker-compose.yml files for each execution
- Mounts current directory as `/workspace/` in the container
- Provides isolated execution environment
- Automatically handles volume mounting for TypedAI home and target repository

**Examples:**
```bash
# Same commands as ai script, but in Docker
aid query "Analyze the database schema in this project"
aid code "Refactor the authentication middleware"
```

## Available CLI Scripts


### agent
General Autonomous Agent
```bash
ai agent [prompt]
# or
npm run agent -- [prompt]
```

- **Purpose**: General-purpose autonomous agent with configurable functions
- **Input**: Prompt from arguments or `src/cli/agent-in` file
- **Functions**: Configurable via `-f` flag (defaults to FileSystemRead)
- **Resume**: Use `-r[=agentId]` to resume previous execution

### chat
Interactive Chat
```bash
ai chat [prompt]
```
- **Purpose**: Starts an interactive chat session with a Large Language Model.
- **Features**:
    - Can start a new chat or resume an existing one with the `-r` flag.
    - Supports model selection with the `-l` or `--llm` flag.
    - Can format the prompt as Markdown with the `-m` flag.
- **Input**: Prompt from arguments or `src/cli/chat.prompt.md`.
- **Output**: The assistant's response is printed to the console and saved to `src/cli/chat-out`.

### code
Code Editing Agent  
```bash
ai code [prompt]
```
- **Purpose**: Specialized agent for code editing and implementation tasks
- **Features**: File analysis, design planning, iterative code changes
- **Best for**: Feature implementation, refactoring, bug fixes
- **Resume**: Supports `-r` flag for continuing previous sessions

### query
Repository Query Agent
```bash
ai query [question]
```
- **Purpose**: Answer questions about codebase structure and functionality
- **Output**: Written to `src/cli/query-out.md`
- **Best for**: Code discovery, understanding existing implementations

### Research and Analysis Scripts

### research
Research Agent
```bash
ai research [topic]
```
- **Purpose**: Conduct research using web search and analysis
- **Functions**: Perplexity search, web scraping
- **Best for**: Market research, technology analysis, competitive intelligence

### review
Code Review Agent
```bash
ai review
```
- **Purpose**: Perform code review on local git branches
- **Features**: Analyzes git diff, provides feedback and suggestions
- **Best for**: Pre-commit code review, quality assurance

### Utility Scripts

### scrape
Web Scraping
```bash
ai scrape <url> [output_file]
```
- **Purpose**: Extract and convert web page content to markdown
- **Output**: Defaults to `scrape.md`
- **Features**: Uses Mozilla Readability for content extraction

### gen
Text Generation
```bash
ai gen [prompt]
```
- **Purpose**: Simple text generation from prompts
- **Input**: Arguments or `src/cli/gen-in` file
- **Output**: Console and `src/cli/gen-out` file

### export
Export Files to XML
```bash
ai export [file_patterns...]
```
- **Purpose**: Consolidates the content of specified files into a single XML-formatted string, which is useful for providing context to LLMs.
- **Features**:
    - Accepts multiple file paths or glob patterns.
    - Can write the output to a file using the `-f[=<name>]` flag (e.g., `-f=my_export.xml`).
    - Calculates and reports the token count of the exported content.
- **Input**: A list of file paths or glob patterns. If none are provided, it exports the entire workspace.
- **Output**: The XML content is printed to the console and can be saved to a file.

### files
AI-Powered File Selection
```bash
ai files [prompt]
```
- **Purpose**: Uses an AI agent to intelligently select a set of relevant files from the codebase based on a natural language prompt.
- **Features**:
    - Analyzes the user's request to understand the context.
    - Scans the project structure and file contents to identify relevant files.
- **Input**: A prompt describing the task or feature to be worked on.
- **Output**: A JSON-formatted list of file paths is saved to `src/cli/files-out`.
- **Best for**: Quickly gathering the necessary files before starting a new development task.

### summarize
Text Summarization Agent
```bash
ai summarize [prompt]
```
- **Purpose**: Uses a specialized agent to generate a detailed summary of a given text.
- **Features**:
    - Employs a multi-step process to expand and enrich the summary for better detail and nuance.
    - Can resume previous summarization tasks.
- **Input**: A text prompt provided as an argument or in the `src/cli/summarize-in` file.
- **Output**: The final summary is logged to the console and saved to `src/cli/summarize-out`.
- **Best for**: Condensing large documents, meeting transcripts, or articles into detailed summaries.

### `commit` - AI-Generated Commit Messages

*   **Usage**: `npm run commit`
*   **Description**:
    *   **Purpose**: Automatically generates a conventional commit message based on staged changes.
    *   **Features**:
        *   Analyzes staged files and their diffs.
        *   Uses an LLM to generate a descriptive commit title and body.
        *   Outputs the generated message to the console.
    *   **Input**: Reads all staged files from the Git index. No command-line arguments are required.
    *   **Output**: Prints a JSON object to the console containing the `title` and `description` for the commit message.
    *   **Best for**: Quickly creating well-formatted and descriptive commit messages without manual effort, ensuring consistency in the commit history.

### Development and Testing Scripts

### swe
Software Developer Agent
```bash
ai swe [prompt]
```
- **Purpose**: Multi-repository software development agent
- **Features**: Clone, branch, and create pull requests
- **Best for**: Cross-repository changes, automation workflows

### index
Repository Indexing
```bash
ai index
```
- **Purpose**: Index repository contents for improved search and analysis
- **Output**: Summary index stored under `.typedai/docs`
- **Best for**: Large codebases, improving query performance

### gaia
GAIA Benchmark
```bash
ai gaia [task_id]
```
- **Purpose**: Run GAIA agent benchmark tasks
- **Features**: Complete specific benchmark tasks or full dataset
- **Best for**: Agent capability testing and evaluation

### swebench
SWE-bench Benchmark Runner
```bash
ai swebench --instance-id [id]
```
- **Purpose**: Runs a software engineering agent on a specific problem from the SWE-bench benchmark.
- **Features**:
    - Sets up an isolated Docker container for the agent to work in.
    - Executes a specialized agent to solve the specified problem.
    - Handles environment setup and cleanup automatically.
- **Input**: A mandatory `--instance-id` specifying the SWE-bench problem.
- **Output**: Agent execution logs and results within the isolated environment.
- **Best for**: Evaluating agent performance on standardized software engineering tasks.

### util
Developer Utility Script
```bash
ai util
```
- **Purpose**: A general-purpose utility script for developers to run and test arbitrary code snippets.
- **Features**:
    - Serves as a testbed for various features like version control, file system operations, and agent-based analysis.
    - Frequently modified by developers to test different parts of the system.
- **Input**: None. The script's behavior is determined by its current internal code.
- **Output**: Varies depending on the code being tested.
- **Best for**: Internal development, debugging, and quick-testing of new functionality.

### watch
File Watcher for AI Actions
```bash
ai watch
```
- **Purpose**: Starts a file system watcher that monitors the `src` directory for changes and triggers AI-driven actions based on special instructions in the code.
- **Features**:
    - Detects `@@ai ... @@` blocks to execute shell commands.
    - Detects `//>> ... //` comments to trigger in-place code generation with an AI agent.
    - Uses a status lock (`AI-STATUS`) to prevent infinite processing loops.
- **Input**: None. The script is triggered by file modifications.
- **Output**: Executes commands or modifies files directly.
- **Best for**: Live development and rapid prototyping with AI assistance.

### Specialized Scripts

### slack
Slack Chatbot
```bash
ai slack
```
- **Purpose**: Start the Slack chatbot service
- **Features**: Interactive chat with configured functions
- **Best for**: Team collaboration, automated responses

### easy
Easy Problems Benchmark
```bash
ai easy
```
- **Purpose**: Run easy problems benchmark suite
- **Features**: Test agent performance on simple reasoning tasks
- **Best for**: Model evaluation and comparison

## Advanced Usage

### Function Classes
Some command for running agents support custom function classes via the `-f` flag:

```bash
# Use specific function classes
ai agent -f=FileSystem,Web,Jira "Create a ticket for the bug in user login"

# Multiple function classes
ai code -f=GitLab,FileStore "Implement OAuth integration"
```

Available function classes include:
- `FileSystem` - Local file operations
- `FileStore` - Large content storage
- `Web` - Web scraping and interaction
- `GitLab` - GitLab API integration
- `Jira` - Jira ticket management
- `Perplexity` - Web search capabilities

### Resume Functionality
Most agents support resuming previous executions:

```bash
# Resume last run of the script
ai code -r

# Resume specific agent by ID
ai agent -r=agent_12345

# Resume with additional prompt
ai code -r "Also add unit tests for the new functionality"
```

### Private Repository Mode
Use the `--private` or `-p` flag to work with private repositories:

```bash
ai code --private "Implement sensitive authentication logic"
```
<!--
### Image Support
Some agents support image inputs for analysis:

```bash
# Analyze screenshots or diagrams
ai query "Explain the architecture shown in diagram.png"
ai code "Implement the UI mockup in design.jpg"
```
-->
## Setup and Configuration

### Environment Setup
1. **Set TYPEDAI_HOME**: Point to your TypedAI repository
   ```bash
   export TYPEDAI_HOME=/path/to/typedai
   export PATH=$TYPEDAI_HOME/bin/path:$PATH
   ```

2. **Run configuration script**:
   ```bash
   source ./bin/configure
   ```

### Node.js Requirements
- Node.js version specified in `.node-version` (currently 22.14.0)
- fnm for version management
- npm dependencies installed

### Docker Setup (for `aid` script)
- Docker Engine installed
- Docker Compose v2 support
- Sufficient disk space for TypedAI container images

## Common Workflows

### Code Development Workflow
```bash
# 1. Analyze existing code
ai query "How is user authentication currently implemented?"

# 2. Plan and implement changes
ai code "Add two-factor authentication support"

# 3. Review changes
ai review

# 4. Generate documentation
ai gen "Create API documentation for the new 2FA endpoints"
```

### Research and Analysis Workflow
```bash
# 1. Research topic
ai research "Best practices for implementing 2FA in web applications"

# 2. Analyze competitor solutions
ai scrape https://example.com/2fa-implementation

# 3. Generate implementation plan
ai agent "Based on research, create implementation plan for 2FA"
```

### Multi-Repository Development
```bash
# 1. Index multiple repositories
ai index

# 2. Cross-repository analysis
ai query "Find all microservices that use the user authentication pattern"

# 3. Implement changes across repositories
ai swe "Update authentication library across all services"
```

## Input Methods

### Command Line Arguments
```bash
# Direct prompt as arguments
ai code "Add logging to the payment processor"
```

### Input Files
```bash
# Read prompt from file (no arguments provided)
ai agent  # Reads from src/cli/agent-in
ai gen    # Reads from src/cli/gen-in
ai code   # Reads from src/cli/code-in
```

### Interactive Mode
Some agents support interactive feedback:
```bash
# Agent will prompt for clarification when needed
ai agent "Help me design a new feature"
```

<!--
## Output and Results

### File Outputs
- `query`: Results written to `src/cli/query-out.md`
- `gen`: Output to `src/cli/gen-out` and console
- `scrape`: Defaults to `scrape.md` or specified file
-->

## Troubleshooting

### Common Issues

**TYPEDAI_HOME not set**
```bash
Error: TYPEDAI_HOME is not set.
```
Solution: Set the environment variable and add to your shell profile.

**Docker issues with `aid`**
```bash
# Check Docker installation
docker compose version

# Verify Docker daemon is running
docker ps
```

**Permission issues**
- Ensure TypedAI directory has proper permissions
- Check that the user can write to the working directory

**Function class not found**
```bash
# Check available function classes
ai agent -f=InvalidClass  # Will show error with available options
```

**Resume failures**
```bash
# Check if agent ID exists
ai code -r=nonexistent_id  # Will show error

# List recent agents (if available)
ls ~/.typedai/cli/  # Shows last run files
```

### Performance Considerations

- **Memory usage**: Large repositories may require significant memory
- **API costs**: Monitor LLM usage, especially with complex agents
- **Network**: Web scraping and research agents require internet access
- **Disk space**: Docker images and agent state can consume storage

### Getting Help

- Check the main [CLI documentation](cli.md) for basic setup
- Review [setup documentation](setup.md) for initial configuration
- Use `--help` flag with individual scripts when available
- Check agent logs for detailed error information
- Monitor agent execution in the web UI for visual debugging

## Best Practices

1. **Use descriptive prompts**: Provide clear, specific instructions for better results
2. **Leverage resume functionality**: Continue complex tasks across multiple sessions
3. **Choose appropriate agents**: Use specialized agents (code, query, research) for specific tasks
4. **Monitor resource usage**: Some agents can consume significant compute resources
5. **Version control**: Commit changes before running code editing agents
6. **Test in isolation**: Use Docker execution (`aid`) for potentially disruptive operations
7. **Function selection**: Choose minimal required function classes for better performance
8. **Iterative approach**: Break complex tasks into smaller, manageable steps
9. **Context management**: Use memory functions to maintain context across sessions
10. **Cost awareness**: Monitor LLM usage and costs, especially for research-heavy tasks

## Integration Examples

### Chaining commands
```bash
ai review | ai query "Are there any security vulnerabilities in this change?"
```
