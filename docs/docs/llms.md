# LLMs

TypedAI provides a simple LLM interface which wraps the Vercel [ai npm package](https://sdk.vercel.ai/) to

- Provide simple overloads to `generateMessage` with a single user message and optionally a system prompt.
- Add OpenTelemetry tracing.
- Add cost tracking.
- Provide common thinking levels (low, medium, high) for LLM which support configurable thinking budgets.
- Save the LLM request/response (LlmCall) to the database.
- API key lookup from environment variables and user profile and `isConfigured()` check.
- Provides the convenience methods `generatedTextWithJson` and `generateTextWithResult` which allow a LLM to generated reasoning/chain-of-thought before generating the answer which is extracted from `<json>` or `<result>` tags.

## Composite Implementations

The LLM interface also allows creating composite implementations, for example:

- Implementations with fallbacks to handle quota exceeded or other errors, e.g using multiple providers for DeepSeek R1 etc.
- Mixture-of-Agents/Multi-agent debate for enhanced reasoning and review of multiple LLMs.

#### CePO

An implementation of the Cerebras CePO multi-agent debate is [provided](https://github.com/TrafficGuard/typedai/blob/main/src/llm/multi-agent/cepo.ts). See:

- [Introducing CePO (Cerebras Planning and Optimization)](https://www.cerebras.ai/blog/cepo)
- [CePO Update](https://www.cerebras.ai/blog/cepo-update-turbocharging-reasoning-models-capability-using-test-time-planning)

#### Fast fallbacks

The [FastMedium](https://github.com/TrafficGuard/typedai/blob/main/src/llm/multi-agent/fastMedium.ts) implemention prefers to use Cerebras Qwen3 235b if the input token count is within its limit, and the prompt doesn't contain any images or files, otherwise it falls back to Gemini 2.5 Flash.

The [FastEasy](https://github.com/TrafficGuard/typedai/blob/main/src/llm/multi-agent/fastEasy.ts) implemention prefers to use Cerebras Qwen3 32b if the input token count is within its limit, and the prompt doesn't contain any images or files, otherwise it falls back to Gemini 2.5 Flash Lite.

#### ReasonerDebate

The [ReasonerDebate](https://github.com/TrafficGuard/typedai/blob/main/src/llm/multi-agent/reasoning-debate.ts) implemention is based on the [Google DeepMind sparse multi-agent debate](https://arxiv.org/abs/2406.11776) paper.

## API key rotation

Some LLM provider implementations support rotating through a set of API keys to reduce quota exceeded errors. This is currently only supported via environment variables.

## Adding LLM services

New LLM services need to be registered in `lmFactory.ts`

## Source links

[LLM interface](https://github.com/TrafficGuard/typedai/blob/main/src/llm/llm.ts)

[BaseLLM class](https://github.com/TrafficGuard/typedai/blob/main/src/llm/base-llm.ts)

[AiLLM class](https://github.com/TrafficGuard/typedai/blob/main/llm/services/ai-llm.ts)

[LLM service implementations](https://github.com/TrafficGuard/typedai/tree/main/src/llm/services)