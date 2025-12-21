# TypedAI Claude Plugins

A collection of plugins for Claude Code providing code analysis, knowledge management, quality gates, notifications, and security features.

## Plugins

| Plugin | Description |
|--------|-------------|
| [code-analysis](./code-analysis) | Codebase query, file selection, and tree visualization |
| [knowledge](./knowledge) | Knowledge extraction from Claude sessions |
| [quality-gates](./quality-gates) | Ensure tests/checks pass before stopping |
| [notifications](./notifications) | Desktop notifications when input needed |
| [security](./security) | Model Armor integration for security checks |

## Prerequisites

Ensure `TYPEDAI_HOME` is set in your `.zshrc` or `.bashrc`:
```bash
export TYPEDAI_HOME=/path/to/typedai
```

## Installation

Add the marketplace in an interactive Claude Code session:
```
/plugin marketplace add $TYPEDAI_HOME/claude-plugins
```

Then enable desired plugins:
```
/plugin enable code-analysis@typedai
/plugin enable knowledge@typedai
/plugin enable quality-gates@typedai
/plugin enable notifications@typedai
```

Or via CLI:
```bash
claude plugin enable code-analysis@typedai
```
