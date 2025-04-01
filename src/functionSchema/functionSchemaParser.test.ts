import { unlinkSync } from 'node:fs';
import { expect } from 'chai';
import { systemDir } from '../appVars';
import { func, funcClass } from './functionDecorators';
import { functionSchemaParser } from './functionSchemaParser';
import { FunctionSchema } from './functions';

@funcClass(__filename)
export class TestClass {
	/**
	 * Simple method without parameters
	 */
	@func()
	simpleMethod(): void {}

	/**
	 * Method with void return type
	 */
	@func()
	methodWithVoidReturn(): void {}

	/**
	 * Method with Promise<void> return type
	 */
	@func()
	async methodWithPromiseVoidReturn(): Promise<void> {}

	/**
	 * Method with parameters
	 * @param {string} arg1 - First argument
	 * @param {number} arg2 - Second argument
	 */
	@func()
	methodWithParams(arg1: string, arg2: number): void {}

	/**
	 * Method with optional parameter and no types or dash in jsdoc
	 * @param arg1 First argument
	 * @param arg2 Optional second argument
	 */
	@func()
	methodWithOptionalParam(arg1: string, arg2?: number): void {}

	/**
	 * Method with a parameter without a param tag, which is hidden from the LLM
	 * @param arg1 First argument
	 */
	@func()
	methodWithHiddenParam(arg1: string, arg2?: number): void {}

	/**
	 * Method with return type
	 * @returns A string value
	 */
	@func()
	methodWithReturnType(): string {
		return 'test';
	}

	/**
	 * Method with Promise return type
	 * @returns {Promise<string>} A string value
	 */
	@func()
	methodReturnsPromise(): Promise<string> {
		return Promise.resolve('test');
	}

	/**
	 * Method with complex return type
	 * @returns {Record<string, number>} A record of string keys and number values
	 */
	@func()
	methodWithComplexReturnType(): Record<string, number> {
		return { a: 1, b: 2 };
	}

	/**
	 * Method with Promise and complex return type
	 * @returns {Promise<Record<string, number>>} A promise that resolves to a record of string keys and number values
	 */
	@func()
	methodWithPromiseComplexReturnType(): Promise<Record<string, number>> {
		return Promise.resolve({ a: 1, b: 2 });
	}
}

describe('functionDefinitionParser', () => {
	let functionSchemas: Record<string, FunctionSchema>;

	before(async () => {
		unlinkSync(`${systemDir()}/functions/src/functionSchema/functionSchemaParser.test.json`);
		functionSchemas = functionSchemaParser(__filename);
	});

	describe('parseDefinitions', () => {
		it('should parse simple method correctly', () => {
			expect(functionSchemas.TestClass_simpleMethod).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_simpleMethod',
				description: 'Simple method without parameters',
				parameters: [],
			});
		});

		it('should parse method with parameters correctly', () => {
			expect(functionSchemas.TestClass_methodWithParams).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_methodWithParams',
				description: 'Method with parameters',
				parameters: [
					{ index: 0, name: 'arg1', type: 'string', description: 'First argument' },
					{ index: 1, name: 'arg2', type: 'number', description: 'Second argument' },
				],
			});
		});

		it('should parse method with optional parameter correctly', () => {
			expect(functionSchemas.TestClass_methodWithOptionalParam).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_methodWithOptionalParam',
				description: 'Method with optional parameter and no types or dash in jsdoc',
				parameters: [
					{ index: 0, name: 'arg1', type: 'string', description: 'First argument' },
					{ index: 1, name: 'arg2', type: 'number', description: 'Optional second argument', optional: true },
				],
			});
		});

		it('should skip args without a @param doc', () => {
			expect(functionSchemas.TestClass_methodWithHiddenParam).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_methodWithHiddenParam',
				description: 'Method with a parameter without a param tag, which is hidden from the LLM',
				parameters: [{ index: 0, name: 'arg1', type: 'string', description: 'First argument' }],
			});
		});

		it('should parse method with return type correctly', () => {
			expect(functionSchemas.TestClass_methodWithReturnType).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_methodWithReturnType',
				description: 'Method with return type',
				parameters: [],
				returns: 'A string value',
				returnType: 'string',
			});
		});

		it('should parse method with a Promise return type to unwrap the return type', () => {
			expect(functionSchemas.TestClass_methodReturnsPromise).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_methodReturnsPromise',
				description: 'Method with Promise return type',
				parameters: [],
				returns: 'A string value',
				returnType: 'string',
			});
		});

		it('should parse method with complex return type correctly', () => {
			expect(functionSchemas.TestClass_methodWithComplexReturnType).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_methodWithComplexReturnType',
				description: 'Method with complex return type',
				parameters: [],
				returns: 'A record of string keys and number values',
				returnType: 'Record<string, number>',
			});
		});

		it('should parse method with Promise and complex return type correctly', () => {
			expect(functionSchemas.TestClass_methodWithPromiseComplexReturnType).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_methodWithPromiseComplexReturnType',
				description: 'Method with Promise and complex return type',
				parameters: [],
				returns: 'A promise that resolves to a record of string keys and number values',
				returnType: 'Record<string, number>',
			});
		});

		it('should not include returnType and returns for void return type', () => {
			expect(functionSchemas.TestClass_methodWithVoidReturn).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_methodWithVoidReturn',
				description: 'Method with void return type',
				parameters: [],
			});
		});

		it('should not include returnType and returns for Promise<void> return type', () => {
			expect(functionSchemas.TestClass_methodWithPromiseVoidReturn).to.deep.equal({
				class: 'TestClass',
				name: 'TestClass_methodWithPromiseVoidReturn',
				description: 'Method with Promise<void> return type',
				parameters: [],
			});
		});
	});
});
