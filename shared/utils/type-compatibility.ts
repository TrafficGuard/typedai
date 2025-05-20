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
