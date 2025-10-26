import { expect } from 'chai';
// Adjust the import path as necessary

import { extractPythonGlobals } from '#agent/autonomous/codegen/codegenAutonomousAgentUtils';
import { convertTypeScriptToPython } from '#agent/autonomous/codegen/pythonCodeGenUtils';

describe('codegenAgentUtils', () => {
	describe('TypeScript to Python Type Conversion', () => {
		// --- Primitives ---
		it('should convert "string" to "str"', () => {
			expect(convertTypeScriptToPython('string')).to.equal('str');
		});
		it('should convert "number" to "float"', () => {
			expect(convertTypeScriptToPython('number')).to.equal('float');
		});
		it('should convert "boolean" to "bool"', () => {
			expect(convertTypeScriptToPython('boolean')).to.equal('bool');
		});
		it('should convert "any" to "Any"', () => {
			expect(convertTypeScriptToPython('any')).to.equal('Any');
		});
		it('should convert "void" to "None"', () => {
			expect(convertTypeScriptToPython('void')).to.equal('None');
		});
		it('should convert "undefined" to "None"', () => {
			expect(convertTypeScriptToPython('undefined')).to.equal('None');
		});
		it('should convert "null" to "None"', () => {
			expect(convertTypeScriptToPython('null')).to.equal('None');
		});

		// --- Binary Types ---
		it('should convert "Buffer" to "bytes"', () => {
			expect(convertTypeScriptToPython('Buffer')).to.equal('bytes');
		});
		it('should convert "Uint8Array" to "bytes"', () => {
			expect(convertTypeScriptToPython('Uint8Array')).to.equal('bytes');
		});
		it('should convert "ArrayBuffer" to "bytes"', () => {
			expect(convertTypeScriptToPython('ArrayBuffer')).to.equal('bytes');
		});

		// --- Basic Generics ---
		it('should convert "Array<string>" to "List[str]"', () => {
			expect(convertTypeScriptToPython('Array<string>')).to.equal('List[str]');
		});
		it('should convert "Array<number>" to "List[float]"', () => {
			expect(convertTypeScriptToPython('Array<number>')).to.equal('List[float]');
		});
		it('should convert "Record<string, number>" to "Dict[str, float]"', () => {
			expect(convertTypeScriptToPython('Record<string, number>')).to.equal('Dict[str, float]');
		});
		it('should convert "Record<string, any>" to "Dict[str, Any]"', () => {
			expect(convertTypeScriptToPython('Record<string, any>')).to.equal('Dict[str, Any]');
		});

		// --- Nested Generics ---
		it('should convert "Array<Array<string>>" to "List[List[str]]"', () => {
			expect(convertTypeScriptToPython('Array<Array<string>>')).to.equal('List[List[str]]');
		});
		it('should convert "Record<string, Array<number>>" to "Dict[str, List[float]]"', () => {
			expect(convertTypeScriptToPython('Record<string, Array<number>>')).to.equal('Dict[str, List[float]]');
		});
		it('should convert "Array<Record<string, boolean>>" to "List[Dict[str, bool]]"', () => {
			expect(convertTypeScriptToPython('Array<Record<string, boolean>>')).to.equal('List[Dict[str, bool]]');
		});

		// --- Unions ---
		it('should handle simple primitive union "string | number | boolean"', () => {
			expect(convertTypeScriptToPython('string | number | boolean')).to.equal('str | float | bool');
		});
		it('should handle union with None "string | undefined"', () => {
			expect(convertTypeScriptToPython('string | undefined')).to.equal('str | None');
		});
		it('should handle union with null "number | null"', () => {
			expect(convertTypeScriptToPython('number | null')).to.equal('float | None');
		});
		it('should handle union with generics "Array<number> | Array<boolean>"', () => {
			expect(convertTypeScriptToPython('Array<number> | Array<boolean>')).to.equal('List[float] | List[bool]');
		});
		it('should handle complex union "string | Array<number> | Record<string, boolean>"', () => {
			expect(convertTypeScriptToPython('string | Array<number> | Record<string, boolean>')).to.equal('str | List[float] | Dict[str, bool]');
		});
		it('should handle union including binary type "string | Buffer"', () => {
			expect(convertTypeScriptToPython('string | Buffer')).to.equal('str | bytes');
		});
		it('should handle ImageSource.specifier type', () => {
			expect(convertTypeScriptToPython('Promise<string | Uint8Array | object>')).to.equal('str | bytes | Dict[str, Any]');
		});

		// --- Object Literals ---
		it('should convert simple object literal "{ key: string; value: number }" to "Dict[str, Any]"', () => {
			// Note: Current simple implementation maps the whole structure
			expect(convertTypeScriptToPython('{ key: string; value: number }')).to.equal('Dict[str, Any]');
		});
		it('should convert complex object literal "{ name: string; scores: Array<number> }" to "Dict[str, Any]"', () => {
			expect(convertTypeScriptToPython('{ name: string; scores: Array<number> }')).to.equal('Dict[str, Any]');
		});
		it('should convert the keyword "object" to "Dict[str, Any]"', () => {
			expect(convertTypeScriptToPython('object')).to.equal('Dict[str, Any]');
		});
		it('should handle union including object literal "string | { message: string }"', () => {
			expect(convertTypeScriptToPython('string | { message: string }')).to.equal('str | Dict[str, Any]');
		});

		// --- Promises ---
		it('should strip "Promise<>" wrapper and convert inner type "Promise<string>"', () => {
			expect(convertTypeScriptToPython('Promise<string>')).to.equal('str');
		});
		it('should strip "Promise<>" wrapper for complex inner type "Promise<Array<number>>"', () => {
			expect(convertTypeScriptToPython('Promise<Array<number>>')).to.equal('List[float]');
		});
		it('should strip "Promise<>" wrapper for void "Promise<void>"', () => {
			expect(convertTypeScriptToPython('Promise<void>')).to.equal('None');
		});
		it('should strip "Promise<>" wrapper for binary type "Promise<Uint8Array>"', () => {
			expect(convertTypeScriptToPython('Promise<Uint8Array>')).to.equal('bytes');
		});

		// --- Edge Cases ---
		it('should handle leading/trailing whitespace "  string  "', () => {
			expect(convertTypeScriptToPython('  string  ')).to.equal('str');
		});
		it('should handle whitespace within generics " Array < string > "', () => {
			// Expect the standard Python formatting without extra inner space
			expect(convertTypeScriptToPython(' Array < string > ')).to.equal('List[str]');
		});
		it('should leave unknown types unchanged "MyCustomType"', () => {
			expect(convertTypeScriptToPython('MyCustomType')).to.equal('MyCustomType');
		});
		it('should leave already Pythonic types unchanged "List[str]"', () => {
			// The regex uses word boundaries, so 'List' shouldn't match 'Array<' etc.
			expect(convertTypeScriptToPython('List[str]')).to.equal('List[str]');
		});
		it('should handle empty string ""', () => {
			expect(convertTypeScriptToPython('')).to.equal('');
		});
		it('should handle just whitespace "   "', () => {
			expect(convertTypeScriptToPython('   ')).to.equal('');
		});
	});

	describe('Python Globals extraction', () => {
		it('parses a single <agent:python_global> (preserves multiline content)', () => {
			const llmResponse = `
  <agent:python_global var="FileXYZ_edit_diff">line1
line2
line3
</agent:python_global>`;
			expect(extractPythonGlobals(llmResponse)).to.deep.equal({
				FileXYZ_edit_diff: 'line1\nline2\nline3\n',
			});
		});

		it('parses multiple <agent:python_global> entries', () => {
			const llmResponse = `
  <agent:python_global var="A">value A</agent:python_global>
  <agent:python_global var="B">value B</agent:python_global>`;
			expect(extractPythonGlobals(llmResponse)).to.deep.equal({
				A: 'value A',
				B: 'value B',
			});
		});

		it('should merge multiple <agent:python_global> tags, with later tags overriding redefined variables', () => {
			// Later tags only override the variables they explicitly redefine, so we merge them cumulatively.
			const llmResponse = `
  <agent:python_global var="A">old A</agent:python_global>
  <agent:python_global var="B">value B</agent:python_global>
...some content...
  <agent:python_global var="A">new A</agent:python_global>
  <agent:python_global var="C">value C</agent:python_global>`;
			expect(extractPythonGlobals(llmResponse)).to.deep.equal({
				A: 'new A',
				B: 'value B',
				C: 'value C',
			});
		});

		it('falls back to the last <python:globals> block if no <agent:python_globals> are present', () => {
			const llmResponse = `
<python:globals>
  <python:global var="A">old A</python:global>
</python:globals>
...some content...
<python:globals>
  <python:global var="A">new A</python:global>
  <python:global var="C">value C</python:global>
</python:globals>`;
			expect(extractPythonGlobals(llmResponse)).to.deep.equal({
				A: 'new A',
				C: 'value C',
			});
		});

		it('returns empty object when no global blocks present', () => {
			const llmResponse = `<response><agent:python_code>print("hi")</agent:python_code></response>`;
			expect(extractPythonGlobals(llmResponse)).to.deep.equal({});
		});
	});
});
