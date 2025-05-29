export type ChangePropertyType<T, K extends keyof T, V> = {
	[P in keyof T]: P extends K ? V : T[P];
};

/**
 * Makes specified properties of T optional
 */
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Constructs a type with all properties of T set to writable.
 */
export type Writable<T> = { -readonly [P in keyof T]: T[P] };
export type AreTypesStructurallyCompatible<TypeA, TypeB> = [TypeA] extends [TypeB] ? ([TypeB] extends [TypeA] ? true : false) : false;
export type HaveSameKeys<TypeA, TypeB> = keyof TypeA extends keyof TypeB ? (keyof TypeB extends keyof TypeA ? true : false) : false;
/**
 * Checks for both structural compatibility and exact key matching.
 * This is the recommended check for ensuring a schema's static type
 * accurately mirrors a model interface.
 */
export type AreTypesFullyCompatible<TypeA, TypeB> = AreTypesStructurallyCompatible<TypeA, TypeB> extends true
	? HaveSameKeys<TypeA, TypeB> extends true
		? true
		: false
	: false;
