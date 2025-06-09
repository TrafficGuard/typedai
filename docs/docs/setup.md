# Setup

```bash
git clone https://github.com/TrafficGuard/typedai.git
cd typedai
source ./bin/configure
```

The `configure` script will guide you through the initial setup of TypedAI
- Check `pyenv`, `fnm` and `ripgrep` are installed
- Configure the application variables in `./variables/local.env`

Note that only Linux and OSX are supported in the script. 

## Configuration quick start

### Base configuration
The `variables/local.env` file contains the configuration when running TypedAI using the `npm run start:local` command.
The `./bin/configure` script will help create and populate this file.
By default, TypedAI runs in `single_user` authentication mode. A user profile will be created the first time the application is run.
The configure script will attempt to set `SINGLE_USER_EMAIL` from your `gcloud` configuration if available. Otherwise, ensure it's set correctly in `variables/local.env`.

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

The `./bin/configure` script will guide you through the initial setup, including configuring Google Cloud services and choosing your database.

1.  **Run the configuration script:**
    ```bash
    source ./bin/configure
    ```
    (Note: Using `source` is recommended to ensure environment variables set by the script, like CLI paths, are available in your current shell session).

2.  **Google Cloud Services:** The script will first ask if you plan to use Google Cloud services (like Vertex AI for Gemini/Claude models, or Cloud Tracing).
    *   If you answer **Yes**:
        *   You will be prompted for your `GCLOUD_PROJECT` ID and `GCLOUD_REGION`.
        *   The script will check for the `gcloud` CLI and attempt to enable common APIs like `aiplatform.googleapis.com`.
        *   `TRACE_AGENT_ENABLED` will be set to `true` in `variables/local.env`.
        *   **Action Required:** You **must** run `gcloud auth application-default login` separately to provide credentials for the application to authenticate with GCP services.
    *   If you answer **No**:
        *   `TRACE_AGENT_ENABLED` will be set to `false`.
        *   The Firestore (Native Mode) database option will not be available in the next step.

3.  **Database Choice:** After configuring (or skipping) general GCP services, the script will prompt you to choose your database type:
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

### Additional Google Cloud Setup (if using Firestore or GCP services)
To use Anthropic Claude through the Vertex API you will need to [enable the Claude models](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#grant-permissions) from the Model Garden. Make sure to click Accept on the final screen. The model garden links are:
- [3.5 Sonnet V2](https://console.cloud.google.com/vertex-ai/publishers/anthropic/model-garden/claude-3-5-sonnet-v2?supportedpurview=project)
- [3.5 Haiku](https://console.cloud.google.com/vertex-ai/publishers/anthropic/model-garden/claude-3-5-haiku?supportedpurview=project)

As Claude is only available in [select regions](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions) there is an additional environment variable `GCLOUD_CLAUDE_REGION` in the sample `local.env` file which defaults to `us-east5`. The configure script will prompt you for this if you enable GCP services.

## Docker setup

`docker compose up --build` starts the development container running the server and web UI.

The docker compose file mounts everything excluding the node_module folders. On subsequent restarts after code changes you can simply run `docker compose up`

## Run on host setup

Install:

- [pyenv](https://github.com/pyenv/pyenv) (Run `curl https://pyenv.run | bash`)
- [fnm](https://github.com/Schniz/fnm) (Fast Node Manager - Run `curl -fsSL https://fnm.vercel.app/install | bash`)
- [ripgrep](https://github.com/BurntSushi/ripgrep?tab=readme-ov-file#installation)
- [gcloud](https://cloud.google.com/sdk/docs/install) (Required if you plan to use Google Cloud services or Firestore)

From the TypedAI repository root, run `source ./bin/configure`. This is the recommended approach, as the script will guide you through the setup process.

Alternatively, if you prefer to set up your environment manually, you can use the following list of actions (which the script performs) as a guide:

- Ensure the python version in *.python-version* is installed.
- Ensure the node.js version in *.node-version* is installed using fnm and run `npm install` for the backend.
- Initialise the environment variable file at *variables/local.env* if it doesn't exist.
- Guide you through configuring Google Cloud services (optional) and choosing your database type.
- Change to the `frontend` folder and run `npm install`.
- Set up CLI environment variables in your shell profile (`.bashrc` or `.zshrc`).

To run the server and web UI locally, in one terminal run
```bash
npm run start:local
```
In a second terminal run
```bash
cd frontend
npm run start:local
```
The UI will be available at [http://localhost:4200](http://localhost:4200)

<br/>

Next see the [CLI](cli.md) page for running the server and UI, and the various scripts available.
