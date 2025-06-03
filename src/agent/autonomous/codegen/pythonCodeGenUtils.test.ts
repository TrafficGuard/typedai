import { expect } from 'chai';
import {camelToSnake, extractDraftPythonCode} from './pythonCodeGenUtils';

describe('PythonCodeGenUtils', () => {

    describe('camelToSnake', () => {
        it('should convert camelCase to snake_case', () => {
            expect(camelToSnake('camelCase')).to.equal('camel_case');
        });
    });


})