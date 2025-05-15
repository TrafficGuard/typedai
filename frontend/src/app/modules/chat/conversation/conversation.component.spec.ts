import {parseMessageContent} from "./conversation.component";

describe('parseMessageContent', () => {
    it('should return an empty array for null input', () => {
        const inputString = null;
        const expectedOutput: any[] = [];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should return an empty array for undefined input', () => {
        const inputString = undefined;
        const expectedOutput: any[] = [];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should return an empty array for an empty string input', () => {
        const inputString = "";
        const expectedOutput: any[] = [];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse plain text into a single text chunk', () => {
        const inputString = "Hello world";
        const expectedOutput = [{ type: 'text', value: "Hello world" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse whitespace-only string into a single text chunk', () => {
        const inputString = "   ";
        const expectedOutput = [{ type: 'text', value: "   " }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a single code block with language correctly', () => {
        const inputString = "```javascript\nconsole.log(\"test\");\n```";
        const expectedOutput = [{ type: 'markdown', value: "```javascript\nconsole.log(\"test\");\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a single code block without language correctly', () => {
        const inputString = "```\ncode\n```";
        const expectedOutput = [{ type: 'markdown', value: "```\ncode\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse text followed by a code block', () => {
        const inputString = "Hello\n```python\nprint(\"world\")\n```";
        const expectedOutput = [{ type: 'text', value: "Hello\n" }, { type: 'markdown', value: "```python\nprint(\"world\")\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a code block followed by text', () => {
        const inputString = "```python\nprint(\"world\")\n```\nHello";
        const expectedOutput = [{ type: 'markdown', value: "```python\nprint(\"world\")\n```" }, { type: 'text', value: "\nHello" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse text, then a code block, then more text', () => {
        const inputString = "Prefix\n```js\nvar x = 1;\n```\nSuffix";
        const expectedOutput = [{ type: 'text', value: "Prefix\n" }, { type: 'markdown', value: "```js\nvar x = 1;\n```" }, { type: 'text', value: "\nSuffix" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse multiple code blocks with interleaving text', () => {
        const inputString = "Block 1\n```code1\ncontent1\n```\nBlock 2\n```code2\ncontent2\n```";
        const expectedOutput = [{ type: 'text', value: "Block 1\n" }, { type: 'markdown', value: "```code1\ncontent1\n```" }, { type: 'text', value: "\nBlock 2\n" }, { type: 'markdown', value: "```code2\ncontent2\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse adjacent code blocks without creating empty text chunks between them', () => {
        const inputString = "```lang1\ncontent1\n``````lang2\ncontent2\n```";
        const expectedOutput = [{ type: 'markdown', value: "```lang1\ncontent1\n```" }, { type: 'markdown', value: "```lang2\ncontent2\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse code blocks separated by only a newline into three chunks (md, text, md)', () => {
        const inputString = "```c1\ncode1\n```\n```c2\ncode2\n```";
        const expectedOutput = [{ type: 'markdown', value: "```c1\ncode1\n```" }, { type: 'text', value: "\n" }, { type: 'markdown', value: "```c2\ncode2\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });
});
