import { expect } from 'chai';
import { camelToSnake, processFunctionArguments } from './pythonCodeGenUtils';

describe('PythonCodeGenUtils', () => {
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
});
