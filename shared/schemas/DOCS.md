# Schema checking

Each TypeBox schema must be followed by a type check which performs a compile-time check that the schema matches the plain interface.

const _entityCheck: AreTypesFullyCompatible<Entity, Static<typeof EntitySchema>> = true;

If there is a compile failure on this line then there is a mismatch between the schema and the interface.

