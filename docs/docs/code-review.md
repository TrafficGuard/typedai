# AI Code reviews

## Scope

TypedAI has support for AI code reviews of GitLab merge requests. Adding GitHub support is a good candidate for using the Code Editor agent to assist with!

The initial code review functionality is for basic style checks focused on the diff changes. Advanced agentic reviews that perform deeper analysis will be a future goal.

## Code review rules configurations

AI code reviews are useful for guidelines where a lint rule doesn't exist yet, or it can't easily be codified.

It can also be useful when a lint rule does exist, but there are many violations which need be fixed in a project before the rule can be enabled at the error level.
In this case the AI reviewer can stop additional violations of a lint rule being added to the code base.

Each configuration has three filters to determine if a review will be done on a diff to minimize LLM costs.

- Included file extensions: The filename must end with one of the file extension(s)
- Required text in diff: The diff must contain the provided text.
- Project paths: If any values are provided the project path must match one of the path globs.

Lines numbers are added to the diffs as comments every 10 lines and in blank lines to assist the AI in providing the correct line number in the merge request diff to add the comment.

![Code review config](https://public.trafficguard.ai/typedai/code-reviews.png)

# GitLab Configuration

You will need to create a webhook in GitLab for the group(s)/project(s) you want to have the AI reviews enabled on.

In `Settings -> Webhooks` configure a webhook to your TypedAI deployment with the *Merge request events* checked.

![Gitlab webhook](https://public.trafficguard.ai/typedai/gitlab-webhook1.png)

![Gitlab webhook](https://public.trafficguard.ai/typedai/gitlab-webhook2.png)

# Reviewer account



https://docs.gitlab.com/api/user_service_accounts/#specify-a-custom-email-address