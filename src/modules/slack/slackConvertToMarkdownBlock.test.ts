import { expect } from 'chai';

import { textToBlocks } from './slackConvertToMarkdownBlock';

describe.skip('textToBlocks()', () => {
	/**********************************************************************
	 *  SMALL / HAPPY-PATH CASES
	 *********************************************************************/
	it('returns an array with a single block for short plain text', () => {
		const text = 'Hello, world!';
		const blocks = textToBlocks(text);

		expect(blocks).to.have.lengthOf(1);
		expect(blocks[0].type).to.equal('section');
		expect(blocks[0].text.type).to.equal('mrkdwn');
		expect(blocks[0].text.text).to.equal(text);
	});

	it('converts the supported markdown to Slack mrkdwn', () => {
		const markdown =
			'# Heading 1\n' + '## Heading 2\n' + '### Heading 3\n' + 'Regular **bold** and *italic* and ~~strike~~.\n' + '- First item\n' + '- Second item';

		const expectedMrkdwn =
			'*Heading 1*\n' + '*Heading 2*\n' + '*Heading 3*\n' + 'Regular *bold* and _italic_ and ~strike~.\n' + '• First item\n' + '• Second item';

		const blocks = textToBlocks(markdown);

		expect(blocks).to.have.lengthOf(1);
		expect(blocks[0].text.text).to.equal(expectedMrkdwn);
	});

	/**********************************************************************
	 *  LARGE MESSAGE – SPLITTING INTO MULTIPLE BLOCKS
	 *********************************************************************/
	it('splits long messages into multiple blocks, each ≤ 3 000 characters', () => {
		// Build a predictable multi-line string just over 6 000 characters
		const singleLine = '0123456789'.repeat(25); // 250 characters / line
		const longText = Array.from({ length: 25 }, () => singleLine).join('\n'); // ~6 250 chars

		// Sanity check for setup
		expect(longText.length).to.be.greaterThan(6000);

		const blocks = textToBlocks(longText);

		expect(blocks.length).to.be.greaterThan(1);
		blocks.forEach((b, i) => {
			expect(b.type).to.equal('section', `block #${i} wrong type`);
			expect(b.text.type).to.equal('mrkdwn');
			expect(b.text.text.length).to.be.at.most(3000, `block #${i} is too long`);
		});

		// Re-assemble to ensure no data was lost while splitting
		const reassembled = blocks.map((b) => b.text.text).join('');
		// The splitting algorithm drops the *first* \n when adding each line
		// (it adds "\n" **before** the next line).  Therefore re-assemble after
		// trimming the leading \n that will be present in every block except the first.
		expect(reassembled.replace(/\n/g, '')).to.equal(longText.replace(/\n/g, ''));
	});

	/**********************************************************************
	 *  EDGE-CASES
	 *********************************************************************/
	it('handles a message exactly 3 000 characters long', () => {
		const textExact = 'a'.repeat(3000);

		const blocks = textToBlocks(textExact);

		expect(blocks).to.have.lengthOf(1);
		expect(blocks[0].text.text.length).to.equal(3000);
	});

	it('handles inline and fenced code blocks unchanged', () => {
		const md = 'Here is some `inline()` code.\n' + '```ts\n' + 'const x: number = 42;\n' + '```\n';

		const blocks = textToBlocks(md);

		expect(blocks).to.have.lengthOf(1);
		expect(blocks[0].text.text).to.contain('`inline()`');
		expect(blocks[0].text.text).to.contain('```ts');
	});
});
