# AI Code Reviews

TypedAI includes a configurable code review system to analyze code changes and provide feedback. This system helps enforce coding standards, catch potential bugs, and improve overall code quality.

The AI reviewer can be used in two primary ways:

1.  **Locally from the command line** to review changes on your current feature branch before you even create a pull request.
2.  **Automatically on GitLab Merge Requests** to provide feedback as part of your team's CI/CD process.

## Scope

The initial code review functionality is focused on analyzing `diffs` (the specific changes in a commit or merge request) against a set of configurable guidelines. These code reviews are especially useful in two scenarios:

1.  For enforcing team-specific guidelines where a standard linter rule doesn't exist.
2.  When a linter rule *does* exist, but there are too many existing violations to enable it. The AI can act as a gatekeeper, preventing *new* violations from being introduced.

Advanced agentic reviews that perform deeper, contextual analysis will be implemented in the future re-using much of the existing functionality in the platform.

## Configuring Code Review Guidelines

Each guideline contains configuration to limit which diffs are inspected to reduce LLM costs.

*   **File extendions**, to filter files with the correct language for the examples
*   **Diff content**, to only analyse diffs which potentially contain violations.
*   **Project filter**, to only analyse diffs from specific projects.

Tags are used to group related guidelines. This is useful for enabling or disabling groups of guidelines at once.

Provide a few before and after examples of the code standards you want to enforce, which provides multi-shot prompting to the LLM.
The review comment is the note that will be posted on the merge request, you can include URLs etc which provide more
information on the review comment.

![Code review config](https://public.trafficguard.ai/typedai/code-reviews.png)



### Local Command-Line Review

You can get instant feedback on your work-in-progress by running a code review directly from your terminal. This helps you catch issues early, long before your code is seen by teammates.

#### Prerequisites

*   You must be inside a Git repository.
*   You must be on a feature branch. The tool will prevent you from running on primary branches like `main`, `master`, or `develop`.

### Running the Review

To run the review on all staged and unstaged changes in your current branch, execute the following command from the root of your project:

```bash
npm run review
```
Or if you have configured the `ai` script on your path
```bash
ai review
```

The agent will then perform the review process, and output the results to the console.

### Example Output

```
$ npm run review

> node --env-file=variables/local.env -r esbuild-register src/cli/review.ts

INFO: Found 5 active code review configs
INFO: Found 3 review tasks needing LLM analysis.

== Review @ src/services/payment.go:49   ======================================
-- Config: Go: Check for Missing Error Handling
-- Code --------------------------------------------------------
   47 | func MakePayment(w http.ResponseWriter, r *http.Request) {
   48 |   _, err := processPayment(100)
   49 |   _ = err // Error is ignored
   50 | }

-- Comment @ line:49 ------------------------------------------
The error returned from `processPayment` is explicitly ignored. This could lead to silent failures. Consider logging the error or returning it to the caller.
----------------------------------------------------------------
```

## GitLab Merge Request Reviews

You can configure a webhook to automatically review new Merge Requests (MRs) in GitLab.

### Environment Variables

Before configuring webhooks, you must set the following environment variables to allow the system to connect to your GitLab instance:

*   `GITLAB_TOKEN`: A GitLab Personal Access Token with `api` scope.
*   `GITLAB_HOST`: The base URL of your GitLab instance (e.g., `gitlab.com`).
*   `GITLAB_GROUPS`: A comma-separated list of top-level GitLab group names that the system should operate on.

### GitLab Webhook Configuration

You will need to create a webhook in GitLab for the group or project you want to enable AI reviews on.

1.  Navigate to your GitLab project or group's **Settings > Webhooks**.
2.  Enter the URL to your TypedAI deployment's webhook endpoint.
3.  Under **Trigger**, select **Merge request events**.
4.  Click **Add webhook**.

![Gitlab webhook](https://public.trafficguard.ai/typedai/gitlab-webhook1.png)![Gitlab webhook](https://public.trafficguard.ai/typedai/gitlab-webhook2.png)

### Reviewer Account

The AI reviews will be posted to GitLab by the user with the email defined the environment variable `TYPEDAI_AGENT_EMAIL`. This should be a service account associated with the `GITLAB_TOKEN` with the `api` scope. It is highly recommended to use a dedicated bot/service account for this purpose.

For more details on creating tokens, refer to the [GitLab documentation](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html).

## GitHub Pull Request Reviews

Not yet implemented. A task to use the coding agents to assist with, leveraging the existing GitHub webhook routes
