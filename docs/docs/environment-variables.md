This document provides comprehensive details about the environment variables utilized within the application, along with their purposes and default values where applicable.


## Core Server Config

**PORT**

- **Description**: The port on which the server application will listen for incoming requests.
- **Default Value**: `3000`

**DATABASE**

- **Description**: Specifies the (persistent) implementation type of the services.
- **Default Value**: `firestore`
- **Options**: `firestore`, `memory`

**AUTH**

- **Description**: Specifies the authentication system.
- **Default Value**: `single_user`
- **Options**: `single_user`, `google_iap`

**SINGLE_USER_EMAIL**

- **Description**: Email of the user in single-user mode.
- **Default Value**: (None - must be set if AUTH=single_user)

**UI_URL**

- **Description**: The base URL for the user interface.
- **Default Value**: `http://localhost:4200/`

**TYPEDAI_FS**

- **Description**: The base path for the FileSystem interface/tool. Useful for editing code in other local repositories. Alternatively use the -fs= arg.
- **Default Value**: (Not set - defaults to `process.cwd()`)

## Google Cloud

**GCLOUD_PROJECT**

- **Description**: The Google Cloud project ID.
- **Default Value**: (Not set)

**GCLOUD_REGION**

- **Description**: The region for Google Cloud resources.
- **Default Value**: `us-central1`

**GCLOUD_CLAUDE_REGION**

- **Description**: The region for Claude AI model usage.
- **Default Value**: `us-east5`

**DATABASE_TYPE**

- **Description**: The database provider. Valid values are memory, firestore or postgres
- **Default Value**: memory
- 
**DATABASE_NAME**

- **Description**: The ID/name of the database to use. Leaving blank will use the (default) database.
- **Default Value**:

## Observability

**LOG_LEVEL**

- **Description**: Specifies the logging level for the application.
- **Default Value**: `debug`
- **Options**: `debug`, `info`, `warn`, `error`, `fatal`

**LOG_PRETTY**

- **Description**: Determines if logging output should be human-readable (pretty format). Set to false for structured JSON logging in server deployments.
- **Default Value**: `true`

**TRACE_AGENT_ENABLED**

- **Description**: Enables or disables OpenTelemetry tracing.
- **Default Value**: `false`

**TRACE_SERVICE_NAME**

- **Description**: The name of the service for tracing purposes.
- **Default Value**: `typedai`

**TRACE_AUTO_INSTRUMENT**

- **Description**: Automatically instruments supported libraries.
- **Default Value**: `false`

**TRACE_SAMPLE_RATE**

- **Description**: The rate at which traces should be sampled.
- **Default Value**: `1` (100%)

## Human-In-The-Loop

Default human-in-the-loop settings if not configured on a new agent.

**HIL_BUDGET**

- **Description**: The budget (in $USD) that can be spent until a human-in-the-loop check is required.
- **Default Value**: `1`

**HIL_COUNT**

- **Description**: The number of iterations of the agent control loop allowed until a human-in-the-loop check is required.
- **Default Value**: `5`

## LLM/AI services

**ANTHROPIC_API_KEY**

- **Description**: API key for accessing Anthropic services.

**OPENAI_API_KEY**

- **Description**: API key for accessing OpenAI services.

**GROQ_API_KEY**

- **Description**: API key for accessing groq.com services.

**TOGETHERAI_KEY**

- **Description**: API key for accessing Together AI services.

**FIREWORKS_KEY**

- **Description**: API key for accessing Fireworks services.

**DEEPSEEK_API_KEY**

- **Description**: API key for accessing DeepSeek services.

## Tools/Integrations

### GitLab

**GITLAB_TOKEN**

- **Description**: Token for authenticating with GitLab.

**GITLAB_HOST**

- **Description**: Hostname of the GitLab instance. If using a self-hosted instance, specify the domain.
- **Default Value**: `www.gitlab.com`

**GITLAB_GROUPS**

- **Description**: Comma-separated list of your groups in GitLab.

### GitHub

**GITHUB_TOKEN**

- **Description**: Token for authenticating with GitHub.

**GITHUB_ORG**

- **Description**: Organization on GitHub.

**GITHUB_USER**

- **Description**: GitHub username.

### Jira

**JIRA_BASE_URL**

- **Description**: Base URL for Jira API.
- **Default Value**: `https://<accountName>.atlassian.net/rest/api/latest/`

**JIRA_EMAIL**

- **Description**: Email address used for Jira authentication.
- **Default Value**: (Not set)

**JIRA_API_TOKEN**

- **Description**: API token for Jira authentication.
- **Default Value**: (Not set)

### Search

**PERPLEXITY_KEY**

- **Description**: API key for Perplexity AI.

**GOOGLE_CUSTOM_SEARCH_ENGINE_ID**

- **Description**: Google Custom Search Engine ID for performing searches.

**GOOGLE_CUSTOM_SEARCH_KEY**

- **Description**: Key for Google Custom Search API.

**SERP_API_KEY**

- **Description**: API key for accessing the SERP API.
