# Sending responses

Regular 2xx responses sending an object must use `reply.sendJSON(responseObject)` so there is type checking from the schema

Other response types should use the helper functions in src/fastify/responses.ts

The current user can be accessed by with the function `import { currentUser } from '#user/userService/userContext';`

If a property is validated from the schema then do not duplicate the validation in the route handler.




## Fastify Route code review

```typescript

```

```typescript
```
