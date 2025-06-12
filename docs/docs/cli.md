There are two main ways to interact with the system:

1. Through web UI with the server running.
2. Using CLI scripts for specific tasks.

## Running the server & UI

Run the following commands from the typedai git repo root directory.

### Local install
In one terminal run
```bash
npm run start:local
```
In a second terminal run
```bash
cd frontend
npm run start:local
```

### Docker

Run `docker compose up`

The UI will be available at [http://localhost:4200](http://localhost:4200)

## CLI commands

## Running in Docker

To run the CLI scripts when using the Docker container, run the script `./bin/container` from the repo root to first open a bash shell inside the TypedAI development container.

### Running outside the repository

To run TypedAI agents/workflows via the CLI script described below, in a folder outside the typedai repository, the script at `bin/path/ai` allows you to invoke the TypedAI package.json scripts from any directory.

The `bin/configure` script will update your shell configuration files to include it in your PATH.

Either run the `bin/configure` script from the TypedAI repository root or copy and run the required section from the script. This will add to your .bashrc and .zshrc files (if they exist) the output of:

```bash
export TYPEDAI_HOME=$(pwd)
export PATH=$TYPEDAI_HOME/bin/path:$PATH
```

Then from any folder you can run commands like:

`ai query what test frameworks does this repository use`

Where *query* is the TypedAI package.json script. For all the examples in the CLI scripts section above you can replace `npm run` with `ai`


### CLI scripts

There are a number of convenience scripts in the package.json for running agents and other scripts such as benchmarks, where the entrypoint file matches `/src/cli/<script-name>.ts`

### agent

`ai agent` will run the autonomous agent configured in `src/cli/agent.ts`. Note that the agent will have the functions available configured in the `agent.ts` file.

If no arguments are supplied the user prompt will be read from `src/cli/agent-in`

Alternatively you can provide the prompt with additional arguments. It's not necessary to quote the prompt unless it has special characters that the shell would interpret.

For example, you could run:
```bash
npm run agent research the latest news about large language models and write a report to the file ai-news.md
```

### code

`ai code` runs the [CodeEditingAgent](/software-engineer/) configured in `src/cli/code.ts`

Without arguments the prompt is read from `src/cli/code-in` otherwise it uses the provided arguments for the prompt.

This is a useful for editing the typedai codebase. You could run a command like:

```bash
npm run code In the anthropic vertex class update the pricing for claude 3.5 sonnet to be 3 dollars per million input tokens and 15 dollars per million output tokens
```

When editing other repositories you will need use the `ss` command to run the agent with its virtual filesystem working 
directory set to the current shell directory.

### index

`ai index`

This runs the agent which indexes a repository, and stores the summary index docs under `.typedai/docs`

### slack

`ai slack` starts the Slack chatbot. The chatbot will have the functions available defined in `src/modules/slack/slackChatBotService.ts`

### swe

`ai swe` runs the SoftwareDeveloperAgent configured in `src/cli/swe.ts`

Without arguments the prompt is read from `src/cli/swe-in` otherwise it uses the provided arguments for the prompt.

The agent is used for editing a remote repository which it will clone, branch and push a merge/pull request.

This agent can be used for process automation and handling requests within the limits of the CodeEditingAgent capabilities in a multi-repo environment.

### gen

`ai gen` runs the script at `src/cli/gen.ts`

This simply generates text from a prompt. As with the other scripts you can provide arguments for a quick prompt. 
Otherwise, prepare the prompt in `src/cli/gen-in` and don't provide any other arguments.

The output is written to `src/cli/gen-out` and the console

### gaia

`ai gaia <task_id>` runs an agent which completes a task from the [GAIA agent benchmark suite](https://huggingface.co/datasets/gaia-benchmark/GAIA) and
completes with the answer in the required format, read and appending from the files defined by the `tasksFile` and `resultsFile` consts in `gaia.ts`.

Without the task_id argument it will attempt to complete all questions in the dataset.

You will first need to download the dataset and convert it to the format required (more detailed steps soon...)

It is extremely important you don't commit and push to a public repository the test/validation dataset.
Make sure the directory you save the files to is in the .gitignore.

### scrape

`ai scrape <url>` runs the PublicWeb.getWebPage function which uses a headless browser to scrape a web page, and then converts
it to a slim format by using the `@mozilla/readability` module to first extract the main contents of the page, and then the `turndown`
package to convert the HTML to Markdown, further reducing the token count.

By default, it writes the output to `scrape.md`. Alternatively you can provide an argument for the file to write to.

### query

`ai query <question>` runs the codebase query agent at *src/swe/discovery/fileSelectionAgent.ts* which can answer ad hoc
questions about a codebase/folder contents.

## Development

### Running tests

Keep the Firestore emulator running in a separate shell or in the background
```bash
npm run emulators
```
```bash
npm run test
```


### Speech-to-text

Speech-to-text is useful writing longer prompts with additional details to guide the agents.

On Mac's you can enable Dictation for quick-access speech-to-text
![List agents](https://public.trafficguard.ai/typedai/dictation.png)

