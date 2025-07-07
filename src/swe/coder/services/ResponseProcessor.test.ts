import { expect } from 'chai';
import * as sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditFormat } from '../coderTypes';
import { processResponse } from './responseProcessor';

const DEFAULT_FENCE: [string, string] = ['```', '```'];
const DEFAULT_EDIT_FORMAT: EditFormat = 'diff-fenced';

describe('ResponseProcessor', () => {
	setupConditionalLoggerOutput();

	afterEach(() => {
		sinon.restore();
	});

	describe('process', () => {
		it('should correctly parse a response with a single valid diff-fenced edit block', () => {
			// Arrange
			const responseText = `
Some preceding text.
\`\`\`typescript
src/file.ts
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
\`\`\`
Some trailing text.`;

			// Act
			const result = processResponse(responseText, 'diff-fenced', DEFAULT_FENCE);

			// Assert
			expect(result.editBlocks).to.have.lengthOf(1);
			expect(result.editBlocks[0]).to.deep.equal({
				filePath: 'src/file.ts',
				originalText: 'const a = 1;\n',
				updatedText: 'const a = 2;\n',
			});
			expect(result.metaRequests.requestedFiles).to.be.null;
			expect(result.metaRequests.requestedQueries).to.be.null;
			expect(result.metaRequests.requestedPackageInstalls).to.be.null;
		});

		it('should correctly parse a response with multiple meta-requests simultaneously', () => {
			// Arrange
			const responseText = `
I need to request files, ask a question, and install a package.

<add-files-json>
{
  "files": [{ "filePath": "path/to/file.ts", "reason": "to inspect it" }]
}
</add-files-json>

<ask-query>find all usages of foobar</ask-query>

<install-packages-json>
{
  "packages": [{ "packageName": "uuid", "reason": "for generating ids" }]
}
</install-packages-json>
`;

			// Act
			const result = processResponse(responseText, 'diff-fenced', DEFAULT_FENCE);

			// Assert
			expect(result.editBlocks).to.be.empty;
			expect(result.metaRequests.requestedFiles).to.deep.equal([{ filePath: 'path/to/file.ts', reason: 'to inspect it' }]);
			expect(result.metaRequests.requestedQueries).to.deep.equal([{ query: 'find all usages of foobar' }]);
			expect(result.metaRequests.requestedPackageInstalls).to.deep.equal([{ packageName: 'uuid', reason: 'for generating ids' }]);
		});

		it('should correctly parse a response containing both edit blocks and meta-requests', () => {
			// Arrange
			const responseText = `
Here are the edits for the file.

path/to/edit.js
\`\`\`javascript
<<<<<<< SEARCH
console.log('old');
=======
console.log('new');
>>>>>>> REPLACE
\`\`\`

Also, I need to install a package.
<install-packages-json>
{
  "packages": [{ "packageName": "lodash", "reason": "for utility functions" }]
}
</install-packages-json>

And I need to see another file.
<add-files-json>
{
  "files": [{ "filePath": "another/file.ts", "reason": "for context" }]
}
</add-files-json>
`;

			// Act
			const result = processResponse(responseText, 'diff-fenced', DEFAULT_FENCE);

			// Assert
			expect(result.editBlocks).to.have.lengthOf(1);
			expect(result.editBlocks[0]).to.deep.equal({
				filePath: 'path/to/edit.js',
				originalText: "console.log('old');\n",
				updatedText: "console.log('new');\n",
			});

			expect(result.metaRequests.requestedFiles).to.deep.equal([{ filePath: 'another/file.ts', reason: 'for context' }]);
			expect(result.metaRequests.requestedQueries).to.be.null;
			expect(result.metaRequests.requestedPackageInstalls).to.deep.equal([{ packageName: 'lodash', reason: 'for utility functions' }]);
		});

		it('should handle an empty response string gracefully', () => {
			// Arrange
			const responseText = '';

			// Act
			const result = processResponse(responseText, 'diff-fenced', DEFAULT_FENCE);

			// Assert
			expect(result.editBlocks).to.be.empty;
			expect(result.metaRequests.requestedFiles).to.be.null;
			expect(result.metaRequests.requestedQueries).to.be.null;
			expect(result.metaRequests.requestedPackageInstalls).to.be.null;
		});

		it('should handle a response with no valid blocks or requests', () => {
			// Arrange
			const responseText = 'This is a regular text response from the LLM without any special blocks.';

			// Act
			const result = processResponse(responseText, 'diff-fenced', DEFAULT_FENCE);

			// Assert
			expect(result.editBlocks).to.be.empty;
			expect(result.metaRequests.requestedFiles).to.be.null;
			expect(result.metaRequests.requestedQueries).to.be.null;
			expect(result.metaRequests.requestedPackageInstalls).to.be.null;
		});

		it('should handle malformed meta-request JSON gracefully', () => {
			// Arrange
			const responseText = `
<add-files-json>
{
  "files": [
    {"filePath": "valid.ts", "reason": "valid"},
    {"invalidStructure": "missing required fields"}
  ]
}
</add-files-json>

<install-packages-json>
this is not valid json
</install-packages-json>
`;
			// Act
			const result = processResponse(responseText, 'diff-fenced', DEFAULT_FENCE);

			// Assert
			expect(result.editBlocks).to.be.empty;
			// The underlying parsers are strict and return null for malformed content
			expect(result.metaRequests.requestedFiles).to.be.null;
			expect(result.metaRequests.requestedPackageInstalls).to.be.null;
		});

		it('should parse edit blocks with the "diff" EditFormat setting', () => {
			// Arrange
			const responseText = `
src/example.ts
\`\`\`typescript
<<<<<<< SEARCH
const oldContent = 'old';
=======
const newContent = 'new';
>>>>>>> REPLACE
\`\`\`
`;
			// Act
			const result = processResponse(responseText, 'diff', DEFAULT_FENCE);

			// Assert
			expect(result.editBlocks).to.have.length(1);
			expect(result.editBlocks[0]).to.deep.equal({
				filePath: 'src/example.ts',
				originalText: "const oldContent = 'old';\n",
				updatedText: "const newContent = 'new';\n",
			});
		});
	});
});
