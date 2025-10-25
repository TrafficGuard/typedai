/**
 * Represents a property within a TypeScript interface
 */
export interface TypeProperty {
	/** The name of the property */
	name: string;
	/** The TypeScript type of the property */
	type: string;
	/** Whether the property is optional */
	optional: boolean;
	/** JSDoc comment for this property */
	description?: string;
}

/**
 * Represents a TypeScript interface definition that will be converted to a Python TypedDict
 */
export interface TypeDefinition {
	/** The name of the interface/type */
	name: string;
	/** The properties of this interface */
	properties: TypeProperty[];
	/** JSDoc description for the entire interface */
	description?: string;
	/** Names of other interfaces this type depends on */
	dependencies?: string[];
}
