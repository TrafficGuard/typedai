import { expect } from 'chai';
import sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { GitLab } from './gitlab';

describe('GitLab', () => {
	setupConditionalLoggerOutput();

	describe('getSingleFileContents', () => {
		let gitlab: GitLab;
		let apiStub: any;
		let showRawStub: sinon.SinonStub;

		beforeEach(() => {
			gitlab = new GitLab();
			showRawStub = sinon.stub();
			apiStub = {
				RepositoryFiles: {
					showRaw: showRawStub,
				},
			};
			sinon.stub(gitlab, 'api').returns(apiStub as any);
		});

		afterEach(() => {
			sinon.restore();
		});

		it('should parse URL and fetch file contents as string', async () => {
			const url = 'https://gitlab.example.com/group/project/-/blob/main/src/file.ts';
			const expectedContents = 'export const file = [];';

			showRawStub.resolves(expectedContents);

			const result = await gitlab.getSingleFileContents(url);

			expect(result).to.equal(expectedContents);
			expect(showRawStub).to.have.been.calledOnceWith('group/project', 'src/file.ts', 'main');
		});

		it('should convert Buffer to string when API returns Buffer', async () => {
			const url = 'https://gitlab.example.com/group/project/-/blob/main/README.md';
			const contents = 'Generic README contents';

			showRawStub.resolves(Buffer.from(contents));

			const result = await gitlab.getSingleFileContents(url);

			expect(result).to.equal(contents);
		});

		it('should throw error for invalid URL format (missing blob marker)', async () => {
			const url = 'https://gitlab.example.com/group/project/main/src/file.ts';

			await expect(gitlab.getSingleFileContents(url)).to.be.rejectedWith('Invalid GitLab blob URL format');
		});

		it('should throw error when project path cannot be extracted', async () => {
			const url = 'https://gitlab.example.com/-/blob/main/src/file.ts';

			await expect(gitlab.getSingleFileContents(url)).to.be.rejectedWith('Could not extract project path');
		});

		it('should throw error when ref and file path cannot be extracted', async () => {
			const url = 'https://gitlab.example.com/group/project/-/blob/main';

			await expect(gitlab.getSingleFileContents(url)).to.be.rejectedWith('Could not extract ref and file path');
		});

		it('should throw error when API call fails', async () => {
			const url = 'https://gitlab.example.com/group/project/-/blob/main/src/file.ts';
			const apiError = new Error('404 Not Found');

			showRawStub.rejects(apiError);

			await expect(gitlab.getSingleFileContents(url)).to.be.rejectedWith('Failed to fetch file from GitLab');
		});

		it('should handle URLs with nested paths', async () => {
			const url = 'https://gitlab.example.com/group/subgroup/project/-/blob/develop/src/deep/nested/file.ts';
			const expectedContents = 'nested file contents';

			showRawStub.resolves(expectedContents);

			const result = await gitlab.getSingleFileContents(url);

			expect(result).to.equal(expectedContents);
			expect(showRawStub).to.have.been.calledWith('group/subgroup/project', 'src/deep/nested/file.ts', 'develop');
		});
	});
});
