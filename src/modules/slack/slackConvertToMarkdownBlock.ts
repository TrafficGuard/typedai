export function convertMarkdownToMrkdwn(markdownText: string): string {
	return (
		markdownText
			// ── italic ──  single * that is NOT preceded/followed by another *
			.replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, '$1_$2_')
			// ── bold ──
			.replace(/\*\*(.+?)\*\*/g, '*$1*')
			// ── strike-through ──
			.replace(/~~(.+?)~~/g, '~$1~')
			// ── code (unchanged) ──
			.replace(/```([^`]*?)```/gs, '```$1```')
			.replace(/`([^`]*?)`/g, '`$1`')
			// ── headings ──
			.replace(/^### (.*)$/gm, '*$1*')
			.replace(/^## {2}(.*)$/gm, '*$1*')
			.replace(/^# {3}(.*)$/gm, '*$1*')
			// ── unordered list ──
			.replace(/^- (.*)$/gm, '• $1')
	);
}
// export function convertMarkdownToMrkdwn(markdownText: string): string {
// 	return markdownText
// 		.replace(/\*\*(.*?)\*\*/g, '*$1*') // Bold: **text** -> *text*
// 		.replace(/\*(.*?)\*/g, '_$1_') // Italic: *text* -> _text_
// 		.replace(/~~(.*?)~~/g, '~$1~') // Strikethrough
// 		.replace(/```([^`]*?)```/gs, '```$1```') // Code blocks (remain the same)
// 		.replace(/`(.*?)`/g, '`$1`') // Inline code (remains the same)
// 		.replace(/^### (.*$)/gm, '*$1*') // H3 headings
// 		.replace(/^## (.*$)/gm, '*$1*') // H2 headings
// 		.replace(/^# (.*$)/gm, '*$1*') // H1 headings
// 		.replace(/^- (.*$)/gm, '• $1'); // Unordered lists
// }

function mrkdwnBlock(text: string): MarkdownBlock {
	return {
		type: 'section',
		text: {
			type: 'mrkdwn',
			text: text,
		},
	};
}

interface MarkdownBlock {
	type: 'section';
	text: {
		type: 'mrkdwn';
		text: string;
	};
}

export function textToBlocks(text: string): MarkdownBlock[] {
	const mrkdwn = convertMarkdownToMrkdwn(text);
	const blocks: MarkdownBlock[] = [];

	if (mrkdwn.length > 3000) {
		// split the message into multiple blocks. Find the first new lines under 3000 characters
		let block = '';
		for (const line of mrkdwn.split('\n')) {
			if (block.length + line.length > 3000) {
				blocks.push(mrkdwnBlock(block));
				block = line;
			} else {
				block += `\n${line}`;
			}
		}
		blocks.push(mrkdwnBlock(block));
	} else {
		blocks.push(mrkdwnBlock(mrkdwn));
	}
	return blocks;
}
