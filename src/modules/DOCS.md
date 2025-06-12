In our Fastify routes we have strict schemas which are defined in the `shared/[module]/[module].schema.ts` files.

Service/Repository tests should ensure that returned objects match their schema.

For example when in the schema file we have:
`const _LlmCallCheck: AreTypesFullyCompatible<LlmCall, Static<typeof LlmCallSchema>> = true;`
Then any service/repository method returning an `LlmCall` object(s) should be validated against `LlmCallSchema`.
e.g. 
const llmCall = await createLlmCall({...});
const isValid = Value.Check(LlmCallSchema, llmCall);