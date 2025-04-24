import { expect } from 'chai';
import type { LlmMessage } from '#llm/llm';
import { AiderCodeEditor } from './aiderCodeEditor';

describe('AiderCodeEditor', () => {
	let codeEditor: AiderCodeEditor;

	beforeEach(() => {
		codeEditor = new AiderCodeEditor();
	});

	describe('parseHistoryFile', () => {
		it('should correctly parse history file', () => {
			const input = `TO LLM 2025-04-24T14:19:32
-------
SYSTEM Act as an expert software developer.
SYSTEM Always use best practices when coding.
-------
USER This is a request
-------
ASSISTANT Ok, any changes I propose will be to those files.
-------
USER 
USER Ensure when making edits that any existing code comments are retained.
LLM RESPONSE 2025-04-24T14:55:17
ASSISTANT Here what to do
ASSISTANT Do this

TO LLM 2025-02-20T10:55:57
-------
SYSTEM Act as an expert software developer.
SYSTEM Always use best practices when coding.
-------
USER The task requires
USER and more...
LLM RESPONSE 2025-04-24T14:57:35
`;

			const systemMessage: LlmMessage = { role: 'system', content: 'Act as an expert software developer.\nAlways use best practices when coding.' };
			// There can be one or more requests to the LLM

			// There can be one or more user messages
			const msg1: LlmMessage[] = [
				systemMessage,
				{ role: 'user', content: 'This is a request' },
				{ role: 'assistant', content: 'Ok, any changes I propose will be to those files.' },
				{ role: 'user', content: '\nEnsure when making edits that any existing code comments are retained.' },
				{ role: 'assistant', content: 'Here what to do\nDo this' },
			];
			// Sometimes there isn't a response from the assistant
			const msg2: LlmMessage[] = [systemMessage, { role: 'user', content: 'The task requires\nand more...' }];
			// @ts-ignore: Accessing private method for testing
			expect(codeEditor.parseHistoryFile(input)).to.deep.equal([msg1, msg2]);
		});
	});
});
