Extract knowledge from the current conversation session to build the project knowledge base.

Carefully ultrathink reviewing in detail every message from the start of the conversation, taking notes on what was learnt along the way, such as:
- Application design/features
- File system paths and project structure
- Why certain decisions were made
- Fixed incorrect code/decisions
- Project-level conventions, patterns, and designs

Focus on knowledge that can be provided to other developers and AI agents, both specific to the applications and general principles. Do NOT include details that are only specific to a single file - this is about capturing project-level knowledge.

After reviewing, save the knowledge report to a timestamped file:
```bash
mkdir -p kb && echo "Saving to kb/$(date '+%Y-%m-%d--%H-%M').md"
```

Write the knowledge report to that file, then confirm what was saved.
