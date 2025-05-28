import { expect } from 'chai';
import { SearchReplaceCoder } from './searchReplaceCoder';
import {setupConditionalLoggerOutput} from "#test/testUtils";

describe('SearchReplaceCoder', () => {

	setupConditionalLoggerOutput();
	describe('Create file check', () => {});

	describe('checkEditBlockFilePath (static private method)', () => {
		it('should return an error message if it finds an existing file with the same parent folder name', () => {
			const existingFilesNames = ['foo', 'path/path2/path3/path4/file'];
			const editFilePath = 'path3/path4/file';

			const result = (SearchReplaceCoder as any).checkEditBlockFilePath(existingFilesNames, editFilePath);

			expect(result).to.not.be.null;
		});

		it('should return an error message if it the path starts with a module alias character', () => {
			const existingFilesNames = [];
			const editFilePath = '#module/file';

			const result = (SearchReplaceCoder as any).checkEditBlockFilePath(existingFilesNames, editFilePath);

			expect(result).to.not.be.null;
		});

		// This will need some work with similarity, dealing with expected similar files (.test etc) to avoid too many false positives
		it.skip('should return an error message if it the path is very similar to an existing path', () => {
			const existingFilesNames = ['frontend/src/app/modules/agents/agent/agent-iterations/agent-iterations.component.ts'];
			const editFilePath = 'frontend/src/app/modules/agents/agent/agent-iterations/AgentIterations.component.ts';

			const result = (SearchReplaceCoder as any).checkEditBlockFilePath(existingFilesNames, editFilePath);

			expect(result).to.not.be.null;
		});

		it('should return null if the file path look unique', () => {
			const existingFilesNames = ['path/path2/path3/path4/file'];
			const editFilePath = 'foo/bar/baz';

			const result = (SearchReplaceCoder as any).checkEditBlockFilePath(existingFilesNames, editFilePath);

			expect(result).to.be.null;
		});
	});
});
