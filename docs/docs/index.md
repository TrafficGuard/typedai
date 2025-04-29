#
<link rel="stylesheet" href="index.css"/>
<p align="center" style="margin-top: 0">
  <img src="https://public.trafficguard.ai/typedai/banner.png" style="height: 100px" alt="TypedAI banner"/>
</p>
<div align="center" style="margin-top: 0">
  <em style="font-size: x-large">The TypeScript-first AI platform for developers</em><br/>
<!--
  <small>Autonomous AI agents and LLM based workflows</small>
-->
</div>

TypedAI is a full-featured platform for developing and running autonomous agents, LLM based workflows, Slack chatbots, AI chat and more.

Included are capable software engineering agents, which have assisted building the platform.

## High level features

- [Advanced Autonomous agents](https://typedai.dev/autonomous-agents)
    - Faster/cheaper actions by generated function calling code (with sandboxed execution)
    - Complex tasks supported with memory, function call history, live files, file store etc.
    - Cost management with configurable Human-in-the-loop settings and cost tracking
    - Persistent state management. Restart from completion/error/human-in-loop
- [Software developer agents](https://typedai.dev/software-engineer/)
    - Local repository editing
    - Ticket-to-pull request workflow
    - Repository indexing and ad-hoc query agents
    - Leverages [Aider](https://aider.chat/) for diff editing
- [Pull request code review agent](https://typedai.dev/code-review/)
- [AI chat interface](https://typedai.dev/chat/)
- [Slack chatbot](https://typedai.dev/chatbot/)
- Supports many LLM services - OpenAI, Anthropic (native & Vertex), Gemini, Groq, Fireworks, Together.ai, DeepSeek, Ollama, Cerebras, SambaNova, OpenRouter, X.ai and more.
- Simple LLM interface wrapping the [Vercel ai](https://sdk.vercel.ai/) package to add tracing and cost tracking.
- Multi-agent [extend-reasoning implementations](https://github.com/TrafficGuard/typedai/tree/main/src/llm/multi-agent) of the LLM interface
- Functional callable tools (Filesystem, Jira, Slack, Perplexity, Google Cloud, Gitlab, GitHub etc)
- OpenTelemetry based observability
- Leverages the extensive Python AI ecosystem through executing Python scripts/packages

## Flexible run/deploy options

- Run from the repository or the provided Dockerfile in single user mode.
- CLI interface
- Web interface
- Scale-to-zero deployment on Firestore & Cloud Run
- Multi-user SSO enterprise deployment (with [Google Cloud IAP](https://cloud.google.com/security/products/iap))
- Terraform, infra scripts and more authentication options coming soon.

## UI Examples

### List agents

![List agents](https://public.trafficguard.ai/typedai/agent-list.png)

### New Agent

![New Agent UI](https://public.trafficguard.ai/typedai/agent-new.png)

### Agent error handling

![Feedback requested](https://public.trafficguard.ai/typedai/agent-feedback.png)

### Agent LLM calls

![Agent LLM calls](https://public.trafficguard.ai/typedai/agent-llm-calls.png)

### Sample trace (Google Cloud)

![Sample trace in Google Cloud](https://public.trafficguard.ai/typedai/trace.png)

### Human in the loop notification

<img src="https://public.trafficguard.ai/typedai/feedback.png" width="702">

### Code review configuration

![Code review configuration](https://public.trafficguard.ai/typedai/code-reviews.png)

### AI Chat

![AI chat](https://public.trafficguard.ai/typedai/chat.png)

### User profile

![Profile](https://public.trafficguard.ai/typedai/profile1.png)
![Profile](https://public.trafficguard.ai/typedai/profile2.png)

Default values can also be set from environment variables.

## Code Examples

### TypedAI vs LangChain

TypedAI doesn't use LangChain, for [many reasons](https://www.octomind.dev/blog/why-we-no-longer-use-langchain-for-building-our-ai-agents) that [you](https://www.google.com/search?q=langchain+site%3Anews.ycombinator.com) can [read](https://www.reddit.com/r/LangChain/comments/1gmfyi2/why_are_people_hating_langchain_so_much/) [online](https://www.google.com/search?q=langchain+sucks+site%3Areddit.com)

The scope of the TypedAI platform covers functionality found in LangChain and LangSmith. 

Let's compare the LangChain document example for Multiple Chains to the equivalent TypedAI implementation.

#### LangChain
```typescript
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatAnthropic } from "@langchain/anthropic";

const prompt1 = PromptTemplate.fromTemplate(
  `What is the city {person} is from? Only respond with the name of the city.`
);
const prompt2 = PromptTemplate.fromTemplate(
  `What country is the city {city} in? Respond in {language}.`
);

const model = new ChatAnthropic({});

const chain = prompt1.pipe(model).pipe(new StringOutputParser());

const combinedChain = RunnableSequence.from([
  {
    city: chain,
    language: (input) => input.language,
  },
  prompt2,
  model,
  new StringOutputParser(),
]);

const result = await combinedChain.invoke({
  person: "Obama",
  language: "German",
});

console.log(result);
```

#### TypedAI
```typescript
import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
import { anthropicLLMs } from '#llms/anthropic'

const cityFromPerson = (person: string) => `What is the city ${person} is from? Only respond with the name of the city.`;
const countryFromCity = (city: string, language: string) => `What country is the city ${city} in? Respond in ${language}.`;

runAgentWorkflow({ llms: anthropicLLMs() }, async () => {
  const city = await llms().easy.generateText(cityFromPerson('Obama'));
  const country = await llms().easy.generateText(countryFromCity(city, 'German'));

  console.log(country);
});
```

The TypedAI code also has the advantage of static typing with the prompt arguments, enabling you to refactor with ease.
Using simple control flow allows easy debugging with breakpoints/logging.

To run a fully autonomous agent:

```typescript
startAgent({
  agentName: 'Create ollama',
  initialPrompt: 'Research how to use ollama using node.js and create a new implementation under the llm folder. Look at a couple of the other files in that folder for the style which must be followed',
  functions: [FileSystem, Perplexity, CodeEditinAgent],
  llms,
});
```

### Automated LLM function schemas

LLM function calling schema are automatically generated by having the `@func` decorator on class methods, avoiding the
definition duplication using zod or JSON.

```typescript
@funcClass(__filename)
export class Jira {
    instance: AxiosInstance | undefined;
    
    /**
     * Gets the description of a JIRA issue
     * @param {string} issueId - the issue id (e.g. XYZ-123)
     * @returns {Promise<string>} the issue description
     */
    @func()
    async getJiraDescription(issueId: string): Promise<string> {
        if (!issueId) throw new Error('issueId is required');
        const response = await this.axios().get(`issue/${issueId}`);
        return response.data.fields.description;
    }
}
```

## Contributing 

We warmly welcome contributions to the project through [issues](https://github.com/TrafficGuard/typedai/issues), [pull requests](https://github.com/TrafficGuard/typedai/pulls)  or [discussions](https://github.com/TrafficGuard/typedai/discussions)
