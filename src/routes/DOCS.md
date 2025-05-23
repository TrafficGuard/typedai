# Fastify API routes

## Sending responses

Regular 2xx responses sending an object must use `reply.sendJSON(responseObject)` so there is type checking from the schema

Other response types should use the helper functions in src/fastify/responses.ts

The current user can be accessed by with the function `import { currentUser } from '#user/userService/userContext';`

If a property is validated from the schema then do not duplicate the validation in the route handler.

Do not cast an object in the sendJSON to avoid compile errors. The static checking is an integral part of our application design.


### Fastify Route code review

BAD example
```typescript
fastify.get(PROMPT_API.getPromptById.pathTemplate, { schema: PROMPT_API.getPromptById.schema }, async (req, reply) => {
    const { promptId } = req.params as Static<typeof PromptParamsSchema>;
    const userId = currentUser().id;
    try {
        const prompt = await (fastify as AppFastifyInstance).promptsService.getPrompt(promptId, userId);
        if (!prompt)  return sendNotFound(reply, 'Prompt not found');
        
        sendJSON(reply, prompt as PromptSchemaModel);
    } catch (error: any) {
        // omitted
    }
});
```

Notes:
- Remove `as Static<typeof PromptParamsSchema>`. Do not cast. Let the static typing do its work to catch errors.
- `(fastify as AppFastifyInstance)` is redundant.
- sendJSON(reply, prompt as PromptSchemaModel) - Do not cast, rely on the static typing to catch errors. Always use reply.sendJSON() to have type checking on the response.

CORRECT example
```typescript
fastify.get(PROMPT_API.getPromptById.pathTemplate, { schema: PROMPT_API.getPromptById.schema }, async (req, reply) => {
    const { promptId } = req.params;
    const userId = currentUser().id;
    try {
        const prompt = await (fastify as AppFastifyInstance).promptsService.getPrompt(promptId, userId);
        if (!prompt)  return sendNotFound(reply, 'Prompt not found');
        
        reply.sendJSON(prompt);
    } catch (error: any) {
        // omitted
    }
});
```
