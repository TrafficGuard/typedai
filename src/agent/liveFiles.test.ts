import { expect } from 'chai';
import { agentContextStorage } from './agentContextLocalStorage';
import { AgentContext } from './agentContextTypes';
import { LiveFiles } from './liveFiles';

describe('LiveFiles', () => {
	let mockContext: AgentContext;
	let liveFiles: LiveFiles;

	beforeEach(() => {
		// Create a minimal mock context
		mockContext = {
			liveFiles: [],
		} as unknown as AgentContext;
		// Mock the agentContext function
		agentContextStorage.enterWith(mockContext);

		liveFiles = new LiveFiles();
	});

	afterEach(() => {
		agentContextStorage.disable();
	});

	it('should correctly add files to the liveFiles array', async () => {
		const filesToAdd = ['src/functionSchema/functionSchemaParser.ts', 'src/agent/codeGenAgentUtils.ts'];

		await liveFiles.addFiles(filesToAdd);

		// Verify the files were added correctly
		expect(mockContext.liveFiles).to.have.length(2);
		expect(mockContext.liveFiles).to.contain('src/functionSchema/functionSchemaParser.ts');
		expect(mockContext.liveFiles).to.contain('src/agent/codeGenAgentUtils.ts');

		// Add another file to test that duplicates are handled correctly
		await liveFiles.addFiles(['src/agent/codeGenAgentUtils.ts', 'src/functionSchema/functions.ts']);

		// Should now have 3 unique files
		expect(mockContext.liveFiles).to.have.length(3);
		expect(mockContext.liveFiles).to.contain('src/functionSchema/functions.ts');
	});

	it('should correctly remove files from the liveFiles array', async () => {
		// First add some files
		const filesToAdd = ['src/functionSchema/functionSchemaParser.ts', 'src/agent/codeGenAgentUtils.ts', 'src/functionSchema/functions.ts'];

		await liveFiles.addFiles(filesToAdd);
		expect(mockContext.liveFiles).to.have.length(3);

		// Now remove one file
		await liveFiles.removeFiles(['src/agent/codeGenAgentUtils.ts']);

		// Verify the file was removed
		expect(mockContext.liveFiles).to.have.length(2);
		expect(mockContext.liveFiles).not.to.contain('src/agent/codeGenAgentUtils.ts');
		expect(mockContext.liveFiles).to.contain('src/functionSchema/functionSchemaParser.ts');
		expect(mockContext.liveFiles).to.contain('src/functionSchema/functions.ts');
	});
});
