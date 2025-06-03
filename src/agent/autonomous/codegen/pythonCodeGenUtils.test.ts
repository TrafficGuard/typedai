import { camelToSnake, extractDraftPythonCode, processFunctionArguments } from './pythonCodeGenUtils';
import { expect } from 'chai';

describe('PythonCodeGenUtils', () => {

    describe('camelToSnake', () => {
        it('should convert camelCase to snake_case', () => {
            expect(camelToSnake('camelCase')).to.equal('camel_case');
        });
    });

    describe('processFunctionArguments', () => {
        const expected = ['filePath', 'content'];

        it('handles camelCase keyword args', () => {
            const { finalArgs, parameters, isKeywordArgs } =
                processFunctionArguments([{ filePath: 'a.txt', content: 'abc' }], expected);
            expect(isKeywordArgs).to.be.true;
            expect(finalArgs).to.deep.equal(['a.txt', 'abc']);
            expect(parameters).to.deep.equal({ filePath: 'a.txt', content: 'abc' });
        });

        it('handles snake_case keyword args', () => {
            const { finalArgs, parameters, isKeywordArgs } =
                processFunctionArguments([{ file_path: 'a.txt', content: 'abc' }], expected);
            expect(isKeywordArgs).to.be.true;
            expect(finalArgs).to.deep.equal(['a.txt', 'abc']);
            expect(parameters).to.deep.equal({ filePath: 'a.txt', content: 'abc' });
        });

        it('handles positional args', () => {
            const { finalArgs, parameters, isKeywordArgs } =
                processFunctionArguments(['a.txt', 'abc'], expected);
            expect(isKeywordArgs).to.be.false;
            expect(finalArgs).to.deep.equal(['a.txt', 'abc']);
            expect(parameters).to.deep.equal({ filePath: 'a.txt', content: 'abc' });
        });
    });
})
