# Static typed/Strongly typed design pattern

The application uses a static typed/strongly typed design by leveraging TypeScript to enforce type safety at compile time
in the interfaces/types/schemas in the `shared` folder shared across the frontend and backend.

This helps catch errors early and makes the code more maintainable.

This design is **fundamental** and must **always** be followed whenever creating or modifying types which are sent/received between the frontend and backend API.

## Models (plain interfaces/types)

Located in `./shard/model/`

```typescript
interface Entity {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
}
// Pick<> properties used to define a derived model type. Array<keyof Entity> enforces correct property names.
const EntityPreviewKeys: Array<keyof Entity> = ['id', 'name'] as const;
// `(typeof Model)[number] lets us use the statically checked property name array which we can re-use in the schema with Type.Pick()
type EntityPreview = Pick<Entity, (typeof EntityPreviewKeys)[number]>
```

The base models map to the database tables and represent the core data structures.

The server API will define derived types for retrieving and updating the base models.

Derived types should generally use Pick<>. Only use Omit<> if excluding small number of properties from a long property list.

## Schemas (TypeBox objects)

Located in `./shard/shemas/`

TypeBox schema objects are used in the Fastify routes to validate the request and response types. 
This ensures that the data being passed to and from the API is valid and conforms to the expected structure.

```typescript
export const EntitySchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
}, { $id: 'Entity' });

const _EntityCheck: AreTypesFullyCompatible<Entity, Static<typeof EntitySchema>> = true;

// Derive the schema using Pick the same way we derive the model type
export const EntityPreviewSchema = Type.Pick(EntitySchema, EntityPreviewKeys, { $id: 'EntityPreview' })

const _EntityPreviewCheck: AreTypesFullyCompatible<EntityPreview, Static<typeof EntityPreviewSchema>> = true;
```

Derived schema objects must use `Type.Pick(BaseSchema, KeysToPick, { $id: 'DerivedSchema' })` (or `Type.Omit(BaseSchema, KeysToOmit, { $id: 'DerivedSchema' })`) 
in the same way the plain model type is derived using Pick<> (or Omit<>).

### Schema compatability checking

Each TypeBox schema must be followed by a type check which performs a compile-time check that the schema matches the plain interface/type.

For example:

`const _entityCheck: AreTypesFullyCompatible<Entity, Static<typeof EntitySchema>> = true;`

If there is a compile failure on this line then there is a mismatch between the schema and the interface.

The compile error `error TS2322: Type 'true' is not assignable to type 'false'` indicates a type mismatch.


## APIs

API definitions in `./shard/api/` uses the schemas objects to validate the request and response types for the backend Fastify routes
and the Angular frontend services, allowing compile-time type checking across the backend and frontend.
This ensures the frontend service calls using `callApiRoute()` from `api-route.ts` match the backend routes registered with `defineRoute()` from `api-definition.ts`.

All angular services **must** use `callApiRoute` to call a backend API route.

# Code Review

When reviewing code changes ensure this statically-typed pattern is always adhered to where required.
