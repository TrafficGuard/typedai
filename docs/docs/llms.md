# LLMs

TypedAI provides a simple LLM interface which wraps the Vercel [ai npm package](https://sdk.vercel.ai/) to

- Provide simple overloads to `generateMessage` with a single user message and optionally a system prompt
- Add OpenTelemetry tracing
- Add cost tracking
- API key lookup and `isConfigured()` check.
- Provides the convenience methods `generatedTextWithJson` and `generateTextWithResult` which allow a LLM to generated reasoning/chain-of-thought before generating the answer which is extracted from `<json>` or `<result>` tags.

The LLM interface also allows creating composite implementations, for example:

- Mixture-of-Agents/Multi-agent debate for enhanced reasoning and review of multiple LLMs
- Implementations with fallbacks to handle quota exceeded or other errors, e.g using multiple providers for DeepSeek R1 or Llama 3.3 70B

New LLM services need to be registered in `lmFactory.ts`

## Source links

[LLM interface](https://github.com/TrafficGuard/typedai/blob/main/src/llm/llm.ts)

[BaseLLM class](https://github.com/TrafficGuard/typedai/blob/main/src/llm/base-llm.ts)

[AiLLM class](https://github.com/TrafficGuard/typedai/blob/main/llm/services/ai-llm.ts)

[LLM service implementations](https://github.com/TrafficGuard/typedai/tree/main/src/llm/services)