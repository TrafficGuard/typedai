<style>
code {
    white-space: nowrap;
}
</style>

# Environment Variables

This document outlines the environment variables used to configure the application. These variables are typically defined in a `.env` file, such as `variables/local.env`. An example file is provided at `variables/local.env.example`.

## General Configuration

| Variable | Description | Default Value |
| --- | --- | --- |
| `NODE_ENV` | The runtime environment. | `development` |
| `LOG_LEVEL` | The logging level. | `debug` |
| `LOG_PRETTY` | If `true`, logs will be formatted for human readability. | `false` |
| `PORT` | The port on which the server will run. | `3000` |
| `DATABASE_TYPE` | The type of database to use (`firestore`, `postgres`, or `memory`). | `memory` |
| `DATABASE_NAME` | The name of the database. | `typedai` |
| `AUTH` | The authentication mode (`single_user` or `google_iap`) | `single_user` |
| `SINGLE_USER_EMAIL` | The email for the user in `single_user` mode. | |
| `API_BASE_URL` | The base URL for the API. | `http://localhost:3000/api/` |
| `UI_URL` | The URL for the user interface. | `http://localhost:4200/` |
| `DEPLOYMENT` | The deployment mode (e.g., `server` or `local`). When not in server mode the human-in-the-loop check will wait for user console input. | `local` |

## Google Cloud

| Variable | Description | Default Value |
| --- | --- | --- |
| `GCLOUD_PROJECT` | The Google Cloud project ID. | |
| `GCLOUD_REGION` | The default Google Cloud region. | `us-central1` |
| `GCLOUD_CLAUDE_REGION` | The region for Anthropic's Claude model on Vertex AI. | `us-east5` |

## OpenTelemetry Tracing

| Variable | Description | Default Value |
| --- | --- | --- |
| `TRACE_AGENT_ENABLED` | If `true`, OpenTelemetry tracing is enabled. | `true` |
| `TRACE_SERVICE_NAME` | The name of the service for tracing. | `typedai` |
| `TRACE_AUTO_INSTRUMENT` | If `true`, auto-instrumentation is enabled. | `false` |
| `TRACE_SAMPLE_RATE` | The trace sample rate. | `1` |

## Human-in-the-Loop (HITL)

| Variable | Description | Default Value |
| --- | --- | --- |
| `HIL_BUDGET` | The budget in USD for autonomous agents before HITL is triggered. | `1` |
| `HIL_COUNT` | The number of agent iterations before HITL is triggered. | `5` |

## LLM Provider API Keys

| Variable | Description |
| --- | --- |
| `ANTHROPIC_API_KEY` | API key for Anthropic. |
| `CEREBRAS_API_KEY` | API key for Cerebras. |
| `DEEPSEEK_API_KEY` | API key for DeepSeek. |
| `DEEPINFRA_API_KEY` | API key for DeepInfra. |
| `FIREWORKS_API_KEY` | API key for Fireworks. |
| `GEMINI_API_KEY` | API key for Gemini. |
| `GROQ_API_KEY` | API key for Groq. |
| `MISTRAL_API_KEY` | API key for Mistral. |
| `NEBIUS_API_KEY` | API key for Nebius. |
| `OLLAMA_API_URL` | URL for a local Ollama instance. |
| `OPENAI_API_KEY` | API key for OpenAI. |
| `OPENROUTER_API_KEY` | API key for OpenRouter. |
| `PERPLEXITY_API_KEY` | API key for Perplexity. |
| `SAMBANOVA_API_KEY` | API key for SambaNova. |
| `TOGETHERAI_API_KEY` | API key for TogetherAI. |
| `XAI_API_KEY` | API key for xAI. |

## GitLab

| Variable | Description |
| --- | --- |
| `GITLAB_TOKEN` | GitLab personal access token. |
| `GITLAB_HOST` | GitLab host (e.g., `www.gitlab.com`). |
| `GITLAB_GROUPS` | Comma-separated list of GitLab groups. |

## GitHub

| Variable | Description |
| --- | --- |
| `GITHUB_TOKEN` | GitHub personal access token. |
| `GITHUB_ORG` | GitHub organization. |
| `GITHUB_USER` | GitHub username. |
| `GITHUB_WEBHOOK_SECRET` | Secret for GitHub webhooks. |

## Jira

| Variable | Description |
| --- | --- |
| `JIRA_BASE_URL` | Your Atlassian instance URL. |
| `JIRA_EMAIL` | Your Jira email address. |
| `JIRA_API_TOKEN` | Your Jira API token. |

## Search

| Variable | Description |
| --- | --- |
| `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | Google Custom Search Engine ID. |
| `GOOGLE_CUSTOM_SEARCH_KEY` | Google Custom Search API key. |
| `SERP_API_KEY` | SerpApi API key. |

## Slack

| Variable | Description |
| --- | --- |
| `SLACK_BOT_TOKEN` | Slack bot token. |
| `SLACK_SIGNING_SECRET` | Slack signing secret. |
| `SLACK_CHANNELS` | Comma-separated list of channels for the bot to listen to. |
| `SLACK_APP_TOKEN` | Slack app-level token. |