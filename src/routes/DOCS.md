Use the helper functions in src/fastify/responses.ts for sending responses

The current user can be accessed by with the function `import { currentUser } from '#user/userService/userContext';`

If a property is validated from the schema then do not duplicate the validation in the route handler.