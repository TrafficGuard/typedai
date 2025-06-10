# Setup

```bash
git clone https://github.com/TrafficGuard/typedai.git
cd typedai
source ./bin/configure
```

The `configure` script will guide you through the initial setup of TypedAI

- Check `pyenv`, `fnm` and `ripgrep` are installed
- Ensure Python and Node.js versions are installed from *.python-version* and *.node-version*.
- Configure the application variables in `./variables/local.env`
- Initialise the projects with `npm install`
- Set up CLI environment variables in your shell profile (`.bashrc` or `.zshrc`).
    - Set `TYPEDAI_HOME` to the repository directory.
    - Add `${TYPEDAI_HOME}/bin/path` to `PATH`

Note that only Linux and OSX are supported in the script. 

## Configuration overview

The `variables/local.env` file contains the configuration when running TypedAI using the `npm run start:local` command.

By default, TypedAI runs in `single_user` authentication mode. A user profile will be created the first time the application is run.

The LLM service API keys and integration configurations can be set on your profile in the web UI, or alternatively in the `variables/local.env` file. Values in the user profile take preferences over the environment configuration values.

Quick links to create API keys:

LLMs
- [Anthropic](https://console.anthropic.com/settings/keys)
- [OpenAI](https://platform.openai.com/api-keys)
- [Groq](https://console.groq.com/keys)
- [Together.ai](https://api.together.ai/settings/api-keys)
- [Fireworks.ai](https://fireworks.ai/api-keys)
- [Deepseek](https://platform.deepseek.com/api_keys)
- [DeepInfra](https://deepinfra.com/dash/api_keys)

Integrations
- [Perplexity](https://www.perplexity.ai/settings/api)
- [Jira](https://id.atlassian.com/manage-profile/security/api-tokens)
- [GitLab](https://www.gitlab.com/-/user_settings/personal_access_tokens)
- [GitHub](https://github.com/settings/tokens?type=beta)


### Google Cloud Platform (GCP) and Database Configuration

The `./bin/configure` script will guide you through the optional Google Cloud services setup
    
1. **Google Cloud Services:** The script will first ask if you plan to use any Google Cloud services (like Vertex AI for Gemini/Claude models, or Cloud Tracing).
    *   If you answer **Yes**:
        *   You will be prompted for your `GCLOUD_PROJECT` ID and `GCLOUD_REGION`.
        *   The script will check for the `gcloud` CLI and attempt to enable common APIs like `aiplatform.googleapis.com`.
        *   `TRACE_AGENT_ENABLED` will be set to `true` in `variables/local.env`.
        *   **Action Required:** You **must** run `gcloud auth application-default login` separately to provide credentials for the application to authenticate with GCP services.
    *   If you answer **No**:
        *   `TRACE_AGENT_ENABLED` will be set to `false`.
        *   The Firestore (Native Mode) database option will not be available in the next step.

2.  **Database Choice:** After configuring (or skipping) general GCP services, the script will prompt you to choose your database type:
    *   **Firestore (Native Mode):**
        *   This option is available **only if** you opted to use GCP services in the previous step (or if `GCLOUD_PROJECT` is already set in `variables/local.env` from a prior run).
        *   Provides serverless, scalable persistence via Google Cloud.
        *   If selected, the script will:
            *   Ensure the Firestore API (`firestore.googleapis.com`) is enabled in your `GCLOUD_PROJECT`.
            *   Create the Firestore database (if it doesn't exist, typically named `(default)`) and required indexes in your specified `GCLOUD_REGION`.
            *   Set `DATABASE_TYPE=firestore` in `variables/local.env`.
    *   *(Coming Soon: Firestore Enterprise Edition with MongoDB compatibility)*
    *   **PostgreSQL:**
        *   Requires Docker or a separately managed PostgreSQL instance.
        *   If selected, the script will:
            *   Prompt to start the PostgreSQL service defined in `docker-compose.yml` using Docker (if Docker is installed).
            *   Remind you to ensure connection details in `variables/local.env` (e.g., `POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`) are correct and that database migrations may be needed.
            *   Set `DATABASE_TYPE=postgres` in `variables/local.env`.
    *   **In-Memory:**
        *   Data is lost when the application stops. Suitable only for quick testing and development.
        *   `DATABASE_TYPE` will be set to `memory` in `variables/local.env`.

### Anthropic Claude on Vertex setup
To use Anthropic Claude through the Vertex API you will need to [enable the Claude models](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#grant-permissions) from the Model Garden. Make sure to click Accept on the final screen. 

The model garden links are:
- [3.5 Sonnet V2](https://console.cloud.google.com/vertex-ai/publishers/anthropic/model-garden/claude-3-5-sonnet-v2?supportedpurview=project)
- [3.5 Haiku](https://console.cloud.google.com/vertex-ai/publishers/anthropic/model-garden/claude-3-5-haiku?supportedpurview=project)

As Claude is only available in [select regions](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions) there is an additional environment variable `GCLOUD_CLAUDE_REGION` in the sample `local.env` file which defaults to `us-east5`. The configure script will prompt you for this if you enable GCP services.


Next see the [CLI](cli.md) page for running the server and UI, and the various scripts available.
