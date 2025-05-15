import {parseMessageContent} from "./conversation.component";

// Add this type definition to match the function's return type
type MessageChunk = { type: 'text' | 'markdown'; value: string };

describe('parseMessageContent', () => {
    it('should return an empty array for null input', () => {
        const inputString = null;
        const expectedOutput: MessageChunk[] = [];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should return an empty array for undefined input', () => {
        const inputString = undefined;
        const expectedOutput: MessageChunk[] = [];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should return an empty array for an empty string input', () => {
        const inputString = "";
        const expectedOutput: MessageChunk[] = [];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse plain text into a single text chunk', () => {
        const inputString = "Hello world";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "Hello world" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse whitespace-only string into a single text chunk', () => {
        const inputString = "   ";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "   " }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a single code block with language correctly', () => {
        const inputString = "```javascript\nconsole.log(\"test\");\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```javascript\nconsole.log(\"test\");\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a single code block without language correctly', () => {
        const inputString = "```\ncode\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```\ncode\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse text followed by a code block', () => {
        const inputString = "Hello\n```python\nprint(\"world\")\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "Hello\n" }, { type: 'markdown', value: "```python\nprint(\"world\")\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a code block followed by text', () => {
        const inputString = "```python\nprint(\"world\")\n```\nHello";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```python\nprint(\"world\")\n```" }, { type: 'text', value: "\nHello" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse text, then a code block, then more text', () => {
        const inputString = "Prefix\n```js\nvar x = 1;\n```\nSuffix";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "Prefix\n" }, { type: 'markdown', value: "```js\nvar x = 1;\n```" }, { type: 'text', value: "\nSuffix" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse multiple code blocks with interleaving text', () => {
        const inputString = "Block 1\n```code1\ncontent1\n```\nBlock 2\n```code2\ncontent2\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "Block 1\n" }, { type: 'markdown', value: "```code1\ncontent1\n```" }, { type: 'text', value: "\nBlock 2\n" }, { type: 'markdown', value: "```code2\ncontent2\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse adjacent code blocks without creating empty text chunks between them', () => {
        const inputString = "```lang1\ncontent1\n``````lang2\ncontent2\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```lang1\ncontent1\n```" }, { type: 'markdown', value: "```lang2\ncontent2\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse code blocks separated by only a newline into three chunks (md, text, md)', () => {
        const inputString = "```c1\ncode1\n```\n```c2\ncode2\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```c1\ncode1\n```" }, { type: 'text', value: "\n" }, { type: 'markdown', value: "```c2\ncode2\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a code block where content does not end with a newline before closing fence', () => {
        const inputString = "```javascript\nconsole.log(\"test\");```";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```javascript\nconsole.log(\"test\");```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse text, then a code block without final newline, then more text', () => {
        const inputString = "Prefix\n```js\nvar x = 1;```\nSuffix";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "Prefix\n" }, { type: 'markdown', value: "```js\nvar x = 1;```" }, { type: 'text', value: "\nSuffix" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse an empty code block (content is empty string)', () => {
        const inputString = "```python\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```python\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a code block with only a newline as content', () => {
        const inputString = "```\n\n```"; // Lang, \n, content (\n), \n (optional), ```
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```\n\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a code block with multiple newlines as content', () => {
        const inputString = "```\n\n\n```"; // Lang, \n, content (\n\n), \n (optional), ```
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```\n\n\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should treat an unterminated code block as plain text', () => {
        const inputString = "Hello ```javascript\nconsole.log('unterminated')";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "Hello ```javascript\nconsole.log('unterminated')" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should treat a code block with missing opening newline as plain text', () => {
        const inputString = "```javascript console.log('no opening newline');\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "```javascript console.log('no opening newline');\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a code block containing backticks in its content', () => {
        const inputString = "```javascript\nconst greeting = `Hello, ${name}!`;\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```javascript\nconst greeting = `Hello, ${name}!`;\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a code block with a language identifier containing a plus sign', () => {
        const inputString = "```c++\n#include <iostream>\nint main() { return 0; }\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```c++\n#include <iostream>\nint main() { return 0; }\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should parse a code block with a language identifier containing an underscore and hyphen', () => {
        const inputString = "```my-lang_v2\nsome_code_here\n```";
        const expectedOutput: MessageChunk[] = [{ type: 'markdown', value: "```my-lang_v2\nsome_code_here\n```" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should treat fences with more than 3 backticks as plain text (current limitation)', () => {
        const inputString = "````javascript\nconsole.log('four backticks');\n````";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "````javascript\nconsole.log('four backticks');\n````" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should treat tilde fences as plain text (current limitation)', () => {
        const inputString = "~~~javascript\nconsole.log('tildes');\n~~~";
        const expectedOutput: MessageChunk[] = [{ type: 'text', value: "~~~javascript\nconsole.log('tildes');\n~~~" }];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });

    it('should handle mixed text and code block without final newline correctly', () => {
        const inputString = "Some leading text.\n```python\nprint('hello')```\nSome trailing text.";
        const expectedOutput: MessageChunk[] = [
            { type: 'text', value: "Some leading text.\n" },
            { type: 'markdown', value: "```python\nprint('hello')```" },
            { type: 'text', value: "\nSome trailing text." }
        ];
        const result = parseMessageContent(inputString);
        expect(result).toEqual(expectedOutput);
    });
});
