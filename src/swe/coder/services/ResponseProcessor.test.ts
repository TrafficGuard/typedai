import { expect } from 'chai';
import * as sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock, EditFormat, RequestedFileEntry, RequestedPackageInstallEntry, RequestedQueryEntry } from '../coderTypes';
// Import modules to stub their exported functions
import * as editBlockParser from '../editBlockParser';
import * as searchReplaceCoder from '../searchReplaceCoder';
import { ResponseProcessor } from './ResponseProcessor';

describe('ResponseProcessor', () => {
	setupConditionalLoggerOutput();

	const DEFAULT_FENCE: [string, string] = ['```', '```'];
	const DEFAULT_EDIT_FORMAT: EditFormat = 'diff-fenced';

	// Mock data for stubbed functions
	const MOCK_EDIT_BLOCKS: EditBlock[] = [{ filePath: 'src/app.ts', originalText: 'old line', updatedText: 'new line' }];
	const MOCK_FILE_REQUESTS: RequestedFileEntry[] = [{ filePath: 'src/utils.ts', reason: 'Helper functions needed' }];
	const MOCK_QUERY_REQUESTS: RequestedQueryEntry[] = [{ query: 'What is the purpose of this module?' }];
	const MOCK_PACKAGE_REQUESTS: RequestedPackageInstallEntry[] = [{ packageName: 'uuid', reason: 'To generate unique IDs' }];

	// Realistic snippets for integration tests
	const addFilesSnippet = `<add-files-json>{"files":[{"filePath":"src/new.ts","reason":"A reason"}]}</add-files-json>`;
	const askQuerySnippet = '<ask-query>A question?</ask-query>';
	const installPkgSnippet = `<install-packages-json>{"packages":[{"packageName":"axios","reason":"For requests"}]}</install-packages-json>`;
	const editBlockSnippet = `\`\`\`typescript\nsrc/app.ts\n<<<<<<< SEARCH\nconsole.log("old");\n=======\nconsole.log("new");\n>>>>>>> REPLACE\n\`\`\``;

	let processor: ResponseProcessor;
	// Stubs will be declared here for type safety and access across tests
	let parseEditResponseStub: sinon.SinonStub;
	let parseAddFilesRequestStub: sinon.SinonStub;
	let parseAskQueryRequestStub: sinon.SinonStub;
	let parseInstallPackageRequestStub: sinon.SinonStub;

	beforeEach(() => {
		processor = new ResponseProcessor(DEFAULT_FENCE, DEFAULT_EDIT_FORMAT);
		// Initialize stubs here
		parseEditResponseStub = sinon.stub(editBlockParser, 'parseEditResponse');
		parseAddFilesRequestStub = sinon.stub(searchReplaceCoder, 'parseAddFilesRequest');
		parseAskQueryRequestStub = sinon.stub(searchReplaceCoder, 'parseAskQueryRequest');
		parseInstallPackageRequestStub = sinon.stub(searchReplaceCoder, 'parseInstallPackageRequest');
	});

	afterEach(() => {
		sinon.restore();
	});

	it('should correctly parse edit blocks when only they are present', () => {
		// Arrange
		parseEditResponseStub.returns(MOCK_EDIT_BLOCKS);
		parseAddFilesRequestStub.returns(null);
		parseAskQueryRequestStub.returns(null);
		parseInstallPackageRequestStub.returns(null);

		// Act
		const result = processor.process('some response text');

		// Assert
		expect(parseEditResponseStub).to.have.been.calledOnceWith('some response text', DEFAULT_EDIT_FORMAT, DEFAULT_FENCE);
		expect(result.editBlocks).to.deep.equal(MOCK_EDIT_BLOCKS);
		expect(result.metaRequests.files).to.be.null;
		expect(result.metaRequests.queries).to.be.null;
		expect(result.metaRequests.packages).to.be.null;
	});

	it('should correctly parse file requests when only they are present', () => {
		// Arrange
		parseEditResponseStub.returns([]);
		parseAddFilesRequestStub.returns(MOCK_FILE_REQUESTS);
		parseAskQueryRequestStub.returns(null);
		parseInstallPackageRequestStub.returns(null);

		// Act
		const result = processor.process('some file request text');

		// Assert
		expect(parseAddFilesRequestStub).to.have.been.calledOnceWith('some file request text');
		expect(result.metaRequests.files).to.deep.equal(MOCK_FILE_REQUESTS);
		expect(result.editBlocks).to.be.an('array').that.is.empty;
		expect(result.metaRequests.queries).to.be.null;
		expect(result.metaRequests.packages).to.be.null;
	});

	it('should correctly parse query requests when only they are present', () => {
		// Arrange
		parseEditResponseStub.returns([]);
		parseAddFilesRequestStub.returns(null);
		parseAskQueryRequestStub.returns(MOCK_QUERY_REQUESTS);
		parseInstallPackageRequestStub.returns(null);

		// Act
		const result = processor.process('some query text');

		// Assert
		expect(parseAskQueryRequestStub).to.have.been.calledOnceWith('some query text');
		expect(result.metaRequests.queries).to.deep.equal(MOCK_QUERY_REQUESTS);
		expect(result.editBlocks).to.be.an('array').that.is.empty;
		expect(result.metaRequests.files).to.be.null;
		expect(result.metaRequests.packages).to.be.null;
	});

	it('should correctly parse package install requests when only they are present', () => {
		// Arrange
		parseEditResponseStub.returns([]);
		parseAddFilesRequestStub.returns(null);
		parseAskQueryRequestStub.returns(null);
		parseInstallPackageRequestStub.returns(MOCK_PACKAGE_REQUESTS);

		// Act
		const result = processor.process('some package text');

		// Assert
		expect(parseInstallPackageRequestStub).to.have.been.calledOnceWith('some package text');
		expect(result.metaRequests.packages).to.deep.equal(MOCK_PACKAGE_REQUESTS);
		expect(result.editBlocks).to.be.an('array').that.is.empty;
		expect(result.metaRequests.files).to.be.null;
		expect(result.metaRequests.queries).to.be.null;
	});

	it('should parse and combine results when response contains both edits and all meta-requests', () => {
		// Arrange
		parseEditResponseStub.returns(MOCK_EDIT_BLOCKS);
		parseAddFilesRequestStub.returns(MOCK_FILE_REQUESTS);
		parseAskQueryRequestStub.returns(MOCK_QUERY_REQUESTS);
		parseInstallPackageRequestStub.returns(MOCK_PACKAGE_REQUESTS);

		// Act
		const result = processor.process('a complex response');

		// Assert
		expect(result.editBlocks).to.deep.equal(MOCK_EDIT_BLOCKS);
		expect(result.metaRequests.files).to.deep.equal(MOCK_FILE_REQUESTS);
		expect(result.metaRequests.queries).to.deep.equal(MOCK_QUERY_REQUESTS);
		expect(result.metaRequests.packages).to.deep.equal(MOCK_PACKAGE_REQUESTS);
	});

	it('should correctly parse a real response containing all content types', () => {
		// Arrange
		sinon.restore(); // Use real parsers
		const responseText = [editBlockSnippet, addFilesSnippet, askQuerySnippet, installPkgSnippet].join('\n');
		processor = new ResponseProcessor(DEFAULT_FENCE, 'diff-fenced');

		// Act
		const result = processor.process(responseText);

		// Assert
		expect(result.editBlocks).to.have.lengthOf(1);
		expect(result.editBlocks[0].filePath).to.equal('src/app.ts');
		expect(result.metaRequests.files).to.have.lengthOf(1);
		expect(result.metaRequests.files?.[0].filePath).to.equal('src/new.ts');
		expect(result.metaRequests.queries).to.have.lengthOf(1);
		expect(result.metaRequests.queries?.[0].query).to.equal('A question?');
		expect(result.metaRequests.packages).to.have.lengthOf(1);
		expect(result.metaRequests.packages?.[0].packageName).to.equal('axios');
	});

	it('should return an empty result structure for a response with no actionable content', () => {
		// Arrange
		parseEditResponseStub.returns([]);
		parseAddFilesRequestStub.returns(null);
		parseAskQueryRequestStub.returns(null);
		parseInstallPackageRequestStub.returns(null);

		// Act
		const result = processor.process('Thinking...');

		// Assert
		expect(result.editBlocks).to.be.an('array').that.is.empty;
		expect(result.metaRequests.files).to.be.null;
		expect(result.metaRequests.queries).to.be.null;
		expect(result.metaRequests.packages).to.be.null;
	});

	it('should return null for a meta-request with malformed JSON', () => {
		// Arrange
		sinon.restore(); // Use real parsers
		const malformedResponse = '<install-packages-json>{ "packages": [ "invalid" ] }</install-packages-json>';
		processor = new ResponseProcessor(DEFAULT_FENCE, DEFAULT_EDIT_FORMAT);

		// Act
		const result = processor.process(malformedResponse);

		// Assert
		expect(result.metaRequests.packages).to.be.null;
		expect(result.editBlocks).to.be.an('array').that.is.empty;
	});
});
