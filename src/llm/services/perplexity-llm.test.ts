import { expect } from 'chai';
import { convertCitationsToMarkdownLinks } from './perplexity-llm';

describe.only('convertCitationsToMarkdownLinks function', () => {
	it('should replace citation IDs with markdown links', () => {
		const reportText = 'something because this [2] and that [3]';
		const citations = ['First Citation', 'Second Citation', 'Third Citation'];

		const expectedOutput = 'something because this [Second Citation](#2) and that [Third Citation](#3)';

		const result = convertCitationsToMarkdownLinks(reportText, citations);
		expect(result).to.equal(expectedOutput);
	});

	it('should handle missing citations', () => {
		const reportText = 'something because this [2] and that [3]';
		const citations = ['First Citation', 'Second Citation'];

		const result = convertCitationsToMarkdownLinks(reportText, citations);
		expect(result).to.equal('something because this [Second Citation](#2) and that [3]');
	});

	it('should handle empty citations array', () => {
		const reportText = 'something because this [2] and that [3]';
		const citations: string[] = [];

		const result = convertCitationsToMarkdownLinks(reportText, citations);
		expect(result).to.equal('something because this [2] and that [3]');
	});

	it('should handle no citation IDs in report text', () => {
		const reportText = 'something because this and that';
		const citations = ['First Citation', 'Second Citation', 'Third Citation'];

		const result = convertCitationsToMarkdownLinks(reportText, citations);
		expect(result).to.equal('something because this and that');
	});
});
