import { expect } from 'chai';
import type { TypeDefinition } from '#functionSchema/typeDefinition';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import {
	camelToSnake,
	convertInterfaceToTypedDict,
	convertTypeScriptTypeToPython,
	generateTypeDefinitionsSection,
	processFunctionArguments,
} from './pythonCodeGenUtils';

describe('PythonCodeGenUtils', () => {
	setupConditionalLoggerOutput();
	describe('camelToSnake', () => {
		it('should convert camelCase to snake_case', () => {
			expect(camelToSnake('camelCase')).to.equal('camel_case');
		});
	});

	describe('processFunctionArguments', () => {
		const expected = ['filePath', 'content'];

		it('handles camelCase keyword args', () => {
			const { finalArgs, parameters } = processFunctionArguments([{ filePath: 'a.txt', content: 'abc' }], expected);
			expect(finalArgs).to.deep.equal(['a.txt', 'abc']);
			expect(parameters).to.deep.equal({ filePath: 'a.txt', content: 'abc' });
		});

		it('handles snake_case keyword args', () => {
			const { finalArgs, parameters } = processFunctionArguments([{ file_path: 'a.txt', content: 'abc' }], expected);
			expect(finalArgs).to.deep.equal(['a.txt', 'abc']);
			expect(parameters).to.deep.equal({ filePath: 'a.txt', content: 'abc' });
		});

		it('handles positional args', () => {
			const { finalArgs, parameters } = processFunctionArguments(['a.txt', 'abc'], expected);
			expect(finalArgs).to.deep.equal(['a.txt', 'abc']);
			expect(parameters).to.deep.equal({ filePath: 'a.txt', content: 'abc' });
		});
	});

	describe('convertTypeScriptTypeToPython', () => {
		it('should convert basic types', () => {
			expect(convertTypeScriptTypeToPython('string')).to.equal('str');
			expect(convertTypeScriptTypeToPython('number')).to.equal('int');
			expect(convertTypeScriptTypeToPython('boolean')).to.equal('bool');
			expect(convertTypeScriptTypeToPython('any')).to.equal('Any');
			expect(convertTypeScriptTypeToPython('void')).to.equal('None');
			expect(convertTypeScriptTypeToPython('null')).to.equal('None');
			expect(convertTypeScriptTypeToPython('undefined')).to.equal('None');
		});

		it('should convert array types', () => {
			expect(convertTypeScriptTypeToPython('string[]')).to.equal('list[str]');
			expect(convertTypeScriptTypeToPython('number[]')).to.equal('list[int]');
			expect(convertTypeScriptTypeToPython('Array<string>')).to.equal('list[str]');
			expect(convertTypeScriptTypeToPython('Array<number>')).to.equal('list[int]');
		});

		it('should convert Record types', () => {
			expect(convertTypeScriptTypeToPython('Record<string, any>')).to.equal('dict[str, Any]');
			expect(convertTypeScriptTypeToPython('Record<string, number>')).to.equal('dict[str, int]');
		});

		it('should convert union types with null to Optional', () => {
			expect(convertTypeScriptTypeToPython('string | null')).to.equal('Optional[str]');
			expect(convertTypeScriptTypeToPython('number | null')).to.equal('Optional[int]');
			expect(convertTypeScriptTypeToPython('string | undefined')).to.equal('Optional[str]');
		});

		it('should preserve other union types', () => {
			expect(convertTypeScriptTypeToPython('string | number')).to.equal('str | int');
		});

		it('should keep custom types unchanged', () => {
			expect(convertTypeScriptTypeToPython('GitProject')).to.equal('GitProject');
			expect(convertTypeScriptTypeToPython('GitProject[]')).to.equal('list[GitProject]');
		});
	});

	describe('convertInterfaceToTypedDict', () => {
		it('should convert a simple interface to TypedDict', () => {
			const typeDef: TypeDefinition = {
				name: 'SimpleProject',
				description: 'A simple project',
				properties: [
					{ name: 'id', type: 'number', optional: false, description: 'Project ID' },
					{ name: 'name', type: 'string', optional: false, description: 'Project name' },
				],
			};

			const result = convertInterfaceToTypedDict(typeDef);
			expect(result).to.include('class SimpleProject(TypedDict):');
			expect(result).to.include('"""A simple project"""');
			expect(result).to.include('id: int');
			expect(result).to.include('"""Project ID"""');
			expect(result).to.include('name: str');
			expect(result).to.include('"""Project name"""');
		});

		it('should handle optional properties with total=False', () => {
			const typeDef: TypeDefinition = {
				name: 'Project',
				properties: [
					{ name: 'id', type: 'number', optional: false },
					{ name: 'description', type: 'string', optional: true },
				],
			};

			const result = convertInterfaceToTypedDict(typeDef);
			expect(result).to.include('class Project(TypedDict, total=False):');
			expect(result).to.include('id: Required[int]');
			expect(result).to.include('description: str');
		});

		it('should handle nullable types with Optional', () => {
			const typeDef: TypeDefinition = {
				name: 'Project',
				properties: [{ name: 'description', type: 'string | null', optional: false }],
			};

			const result = convertInterfaceToTypedDict(typeDef);
			expect(result).to.include('description: Optional[str]');
		});

		it('should handle array types', () => {
			const typeDef: TypeDefinition = {
				name: 'Project',
				properties: [{ name: 'tags', type: 'string[]', optional: true }],
			};

			const result = convertInterfaceToTypedDict(typeDef);
			expect(result).to.include('tags: list[str]');
		});

		it('should convert camelCase property names to snake_case', () => {
			const typeDef: TypeDefinition = {
				name: 'Project',
				properties: [
					{ name: 'fullPath', type: 'string', optional: false },
					{ name: 'defaultBranch', type: 'string', optional: false },
				],
			};

			const result = convertInterfaceToTypedDict(typeDef);
			expect(result).to.include('full_path: str');
			expect(result).to.include('default_branch: str');
		});

		it('should preserve property descriptions as inline comments', () => {
			const typeDef: TypeDefinition = {
				name: 'Project',
				properties: [{ name: 'name', type: 'string', optional: false, description: 'The project name' }],
			};

			const result = convertInterfaceToTypedDict(typeDef);
			expect(result).to.include('"""The project name"""');
		});
	});

	describe('generateTypeDefinitionsSection', () => {
		it('should generate empty string when no type definitions', () => {
			const result = generateTypeDefinitionsSection([]);
			expect(result).to.equal('');
		});

		it('should generate a single TypedDict', () => {
			const typeDefs: TypeDefinition[] = [
				{
					name: 'SimpleProject',
					description: 'A simple project',
					properties: [
						{ name: 'id', type: 'number', optional: false },
						{ name: 'name', type: 'string', optional: false },
					],
				},
			];

			const result = generateTypeDefinitionsSection(typeDefs);
			expect(result).to.include('class SimpleProject(TypedDict):');
			expect(result).to.include('"""A simple project"""');
			expect(result).to.include('id: int');
			expect(result).to.include('name: str');
		});

		it('should generate multiple TypedDicts in dependency order', () => {
			const typeDefs: TypeDefinition[] = [
				{
					name: 'Address',
					properties: [{ name: 'street', type: 'string', optional: false }],
				},
				{
					name: 'Person',
					properties: [
						{ name: 'name', type: 'string', optional: false },
						{ name: 'address', type: 'Address', optional: false },
					],
					dependencies: ['Address'],
				},
			];

			const result = generateTypeDefinitionsSection(typeDefs);

			// Address should appear before Person
			const addressIndex = result.indexOf('class Address');
			const personIndex = result.indexOf('class Person');
			expect(addressIndex).to.be.lessThan(personIndex);
			expect(result).to.include('address: Address');
		});

		it('should handle duplicate type definitions', () => {
			const typeDefs: TypeDefinition[] = [
				{
					name: 'Project',
					properties: [{ name: 'id', type: 'number', optional: false }],
				},
				{
					name: 'Project',
					properties: [{ name: 'id', type: 'number', optional: false }],
				},
			];

			const result = generateTypeDefinitionsSection(typeDefs);

			// Should only generate the type once
			const matches = result.match(/class Project/g);
			expect(matches).to.have.lengthOf(1);
		});

		it('should add proper spacing between TypedDict definitions', () => {
			const typeDefs: TypeDefinition[] = [
				{
					name: 'TypeA',
					properties: [{ name: 'a', type: 'string', optional: false }],
				},
				{
					name: 'TypeB',
					properties: [{ name: 'b', type: 'string', optional: false }],
				},
			];

			const result = generateTypeDefinitionsSection(typeDefs);

			// Should have blank lines between definitions
			expect(result).to.include('class TypeA');
			expect(result).to.include('class TypeB');
			expect(result.split('\n\n').length).to.be.greaterThan(1);
		});
	});
});
