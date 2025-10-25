import { unlinkSync } from 'node:fs';
import { expect } from 'chai';
import { systemDir } from '#app/appDirs';
import { func, funcClass } from './functionDecorators';
import { functionSchemaParser } from './functionSchemaParser';
import type { FunctionSchema } from './functions';

/**
 * A simple project interface for testing
 */
// biome-ignore lint/suspicious/noExportsInTest: Interface needed for parser testing
export interface SimpleProject {
	/** The project ID */
	id: number;
	/** The project name */
	name: string;
	/** Optional description */
	description: string | null;
	/** List of tags */
	tags?: string[];
}

@funcClass(__filename)
class TestClassWithTypes {
	/**
	 * Method that returns a custom interface type
	 * @returns The project details
	 */
	@func()
	async getProject(): Promise<SimpleProject> {
		return { id: 1, name: 'test', description: null };
	}

	/**
	 * Method that returns an array of custom interface type
	 * @returns Array of projects
	 */
	@func()
	async getProjects(): Promise<SimpleProject[]> {
		return [];
	}
}

describe('functionSchemaParser with custom types', () => {
	let functionSchemas: Record<string, FunctionSchema>;

	before(async () => {
		try {
			unlinkSync(`${systemDir()}/functions/src/functionSchema/functionSchemaParserWithTypes.test.json`);
		} catch (e) {
			// File might not exist
		}
		functionSchemas = functionSchemaParser(__filename);
	});

	describe('parseDefinitions with custom interface types', () => {
		it('should extract type definitions for custom interface return type', () => {
			const schema = functionSchemas.TestClassWithTypes_getProject;
			expect(schema.returnType).to.equal('SimpleProject');
			expect(schema.typeDefinitions).to.exist;
			expect(schema.typeDefinitions).to.have.lengthOf(1);

			const typeDef = schema.typeDefinitions![0];
			expect(typeDef.name).to.equal('SimpleProject');
			expect(typeDef.description).to.equal('A simple project interface for testing');
			expect(typeDef.properties).to.have.lengthOf(4);

			// Check id property
			const idProp = typeDef.properties.find((p) => p.name === 'id');
			expect(idProp).to.deep.equal({
				name: 'id',
				type: 'number',
				optional: false,
				description: 'The project ID',
			});

			// Check name property
			const nameProp = typeDef.properties.find((p) => p.name === 'name');
			expect(nameProp).to.deep.equal({
				name: 'name',
				type: 'string',
				optional: false,
				description: 'The project name',
			});

			// Check description property (with null)
			const descProp = typeDef.properties.find((p) => p.name === 'description');
			expect(descProp).to.deep.equal({
				name: 'description',
				type: 'string | null',
				optional: false,
				description: 'Optional description',
			});

			// Check tags property (optional)
			const tagsProp = typeDef.properties.find((p) => p.name === 'tags');
			expect(tagsProp).to.deep.equal({
				name: 'tags',
				type: 'string[]',
				optional: true,
				description: 'List of tags',
			});
		});

		it('should extract type definitions for array of custom interface', () => {
			const schema = functionSchemas.TestClassWithTypes_getProjects;
			expect(schema.returnType).to.equal('SimpleProject[]');
			expect(schema.typeDefinitions).to.exist;
			expect(schema.typeDefinitions).to.have.lengthOf(1);

			const typeDef = schema.typeDefinitions![0];
			expect(typeDef.name).to.equal('SimpleProject');
		});
	});
});
