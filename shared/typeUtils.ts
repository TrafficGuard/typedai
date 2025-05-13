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
