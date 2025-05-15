# Derived types

Use Type.Pick() and Type.Omit() to define similar derived types, just as the plain interfaces use  Pick<> and Omit<>.

# Schema checking

Each TypeBox schema must be followed by a type check which performs a compile-time check that the schema matches the plain interface.

const _entityCheck: AreTypesFullyCompatible<Entity, Static<typeof EntitySchema>> = true;

If there is a compile failure on this line then there is a mismatch between the schema and the interface.

The compile error `error TS2322: Type 'true' is not assignable to type 'false'` indicates a type mismatch.

