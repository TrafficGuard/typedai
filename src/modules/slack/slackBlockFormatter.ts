import { llms } from '#agent/agentContextLocalStorage';
import { convertMarkdownToMrkdwn } from './slackMessageFormatter';

/*
https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
https://ai-sdk.dev/docs/reference/ai-sdk-core/json-schema
https://docs.slack.dev/reference/block-kit/
*/

// https://docs.slack.dev/reference/block-kit/blocks/markdown-block/
// The markdown types that are not supported are code block with syntax highlighting, horizontal lines, tables, and task list.
interface MarkdownBlock {
	type: 'markdown';
	text: string;
}

// https://docs.slack.dev/reference/block-kit/blocks/divider-block/
interface DividerBlock {
	type: 'divider';
}

// https://docs.slack.dev/reference/block-kit/blocks/table-block
interface TableBlock {
	type: 'table';
	/** An array consisting of table rows. Maximum 100 rows. Each row object is an array with a max of 20 table cells. Table cells can have a type of { type="raw_text", text=""}  */
	rows: string[][];
	column_settings?: Array<{ align?: string; is_wrapped?: boolean }>;
}

const SLACK_BLOCKS_SCHEMA = {
	type: 'object',
	properties: {
		blocks: {
			type: 'array',
			description: 'Array of Slack blocks',
			items: {
				type: 'object',
				properties: {
					type: {
						type: 'string',
						description: 'Block type: markdown, divider, or table',
					},
					text: {
						type: 'string',
						description: 'The markdown-formatted text content (for markdown blocks)',
					},
					rows: {
						type: 'array',
						description: 'Array of table rows (for table blocks)',
						items: {
							type: 'array',
							items: {
								type: 'string',
							},
						},
					},
					column_settings: {
						type: 'array',
						description: 'Optional column settings (for table blocks)',
						items: {
							type: 'object',
							properties: {
								align: {
									type: 'string',
								},
								is_wrapped: {
									type: 'boolean',
								},
							},
						},
					},
				},
				required: ['type'],
			},
		},
	},
	required: ['blocks'],
};

interface SlackBlocks {
	blocks: Array<MarkdownBlock | DividerBlock | TableBlock>;
}

const SLACK_MARKDOWN_FORMATTING_RULES = [
	'## Markdown Formatting Rules Overview',
	'1. **Bold**  ',
	'   - Use double asterisks (``**text**``) or double underscores (``__text__``).  ',
	'   - Example: ``**important**`` or ``__urgent__`` appears as **important**/**urgent** (visually bolded).  ',
	'',
	'2. **Italic**  ',
	'   - Use single asterisks (``*text*``) or single underscores (``_text_``).  ',
	'   - Example: ``*note*`` or ``_caution_`` appears as *note*/*caution* (visually italicized).  ',
	'',
	'3. **Bold + Italic**  ',
	'   - Nest italic inside bold: ``**bold with _emphasis_**``  ',
	'   - *Alternatively*, use triple asterisks for combined effect: ``***critical***`` → ***critical*** (bold + italic).  ',
	'',
	'4. **Links**  ',
	'   - Syntax: ``[display text](URL)``  ',
	'   - Example: ``[Google](https://www.google.com)`` becomes a clickable link labeled "Google".  ',
	'',
	'5. **Lists**  ',
	'   - **Unordered**: Start lines with ``- `` + space.  ',
	'     ```',
	'     - Item one',
	'     - Item two',
	'     - Item three',
	'     ```  ',
	'   - **Ordered**: Start lines with ``1. ``, ``2. ``, etc. + space.  ',
	'     ```',
	'     1. First step',
	'     2. Second step',
	'     3. Third step',
	'     ```  ',
	'',
	'6. **Strikethrough**  ',
	'   - Use double tildes: ``~~deleted text~~`` → appears with a strikethrough line.  ',
	'',
	'7. **Headers**  ',
	'   - ``# Header`` → Level 1 (largest/bold)  ',
	'   - ``## Header`` → Level 2 (bold)  ',
	'   - ``### Header`` → Level 3 (bold, smaller), etc.  ',
	'',
	'8. **Inline Code**  ',
	'   - Wrap code in single backticks: `` `print("hello")` `` → displays as monospace font.  ',
	'',
	'9. **Block Quotes**  ',
	'   - Start with ``> `` + space: ``> This is a quote`` → appears indented as a quote block.  ',
	'',
	'10. **Code Blocks**  ',
	'    - Wrap multi-line code in triple backticks:  ',
	'      ```',
	'      ```',
	'      line one',
	'      line two',
	'      ```',
	'      ```  ',
	'    - Appears as a formatted code block (monospace, preserved whitespace).  ',
	'',
	'11. **Images**  ',
	'    - Syntax: ``![alt text](image_URL)``  ',
	'    - Example: ``![Logo](https://example.com/logo.png)`` → displays image with "Logo" as alt text.  ',
	'',
	'---',
	'',
	'### **Escaping Special Characters**  ',
	'To display literal punctuation (instead of triggering formatting), prefix with ``\\\\``:  ',
	'- ``\\\\*`` → shows ``*`` (not italic)  ',
	'- ``\\\\_`` → shows ``_`` (not underscore)  ',
	'- ``\\\\\\\\`` → shows ``\\\\``  ',
	'- Other escapable characters: `` ` ``, ``{``, ``}``, ``[``, ``]``, ``(``, ``)``, ``#``, ``+``, ``-``, ``.``, ``!``, ``&``.  ',
	'  Example: ``\\\\# not a header`` → displays ``# not a header``.  ',
	'',
	'---',
	'',
	'### **Key Notes for Usage**  ',
	'- Always separate list items/punctuation with spaces (e.g., ``- `` not ``-``).  ',
	'- Headers must start at the beginning of a line (no leading spaces).  ',
	'- Code blocks require **three backticks** on separate lines above/below the code.  ',
	'- Avoid nested markdown complexity (e.g., mixing ```***bold-italic***``` with links may render inconsistently).  ',
	'- Escaping is required only for characters that *start* a formatting rule (e.g., ``\\\\*`` needed but ``text*`` is safe).  ',
	'',
	'---  ',
].join('\n');

/**
 * Formats markdown to Slack blocks, using markdown blocks, table blocks and divider blocks, as the Slack markdown doesn't support code block with syntax highlighting, horizontal lines, tables, and task list.
 * @param message
 */
export async function formatAsSlackBlocks(markdown: string): Promise<SlackBlocks> {
	const prompt = `<message>${markdown}</message>\n\nYou are a Slack block formatter. Convert the message text/markdown to Slack blocks.

<formatting-rules>
${SLACK_MARKDOWN_FORMATTING_RULES}

Slack markdown doesn't support code block with syntax highlighting, horizontal lines, tables, and task list.
Horizontal lines must be converted to divider blocks.
Tables must be converted to table blocks.
Code blocks must have the language type stripped in the Markdown.
</formatting-rules>

<response-format>
interface MarkdownBlock {
    type: 'markdown';
    text: string;
}

interface DividerBlock {
    type: 'divider';
}

interface TableBlock {
    type: 'table';
    /** An array consisting of table rows. Maximum 100 rows. Each row object is an array with a max of 20 table cells. Table cells can have a type of { type="raw_text", text=""}  */
    rows: string[][];
    /** 
     * Optional column settings 
     * align: The alignment for items in this column. Can be left, center, or right. Defaults to left if not defined.
     * is_wrapped: Whether the column should be wrapped. Defaults to false if not defined.
     */
    column_settings?: Array<{ align?: string, is_wrapped?: boolean }>
}

Return only a JSON object matching the type
{
    blocks: Array<MarkdownBlock | DividerBlock | TableBlock>
}
</response-format>`;
	const blocks: SlackBlocks = await llms().easy.generateJson(prompt, { jsonSchema: SLACK_BLOCKS_SCHEMA, id: ' Markdown block formatter', temperature: 0 });
	for (const block of blocks.blocks) if (block.type === 'markdown') block.text = convertMarkdownToMrkdwn(block.text);
	return blocks;
}
