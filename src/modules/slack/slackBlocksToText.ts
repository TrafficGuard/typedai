import { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import { llms } from '#agent/agentContextLocalStorage';
import { SlackUser } from './slackChatBotService';
/**
 * Converts a list of Slack message blocks into markdown format, preserving any code blocks, links, formatting etc.
 * Replaces user ids with user profiles and user mentions with user names.
 * @param messages The list of message blocks to convert.
 * @param users The map of user profiles to use for user mentions.
 * @returns The markdown content of the messages.
 */
export async function convertMessageBlocksToMarkdown(messages: MessageElement[], users: Map<string, SlackUser>): Promise<string> {
	updateMessageUserIdsWithProfile(messages, users);
	let prompt = `<slack-messages>\n${JSON.stringify(messages)}\n</slack-messages>\n\n`;
	prompt += 'Convert the Slack message blocks into markdown format, preserving any code blocks, links, formatting etc.\n';
	prompt += 'Ensure the sending user and timestamp are included at the start of each message.\n';
	prompt += 'Return only the markdown content without any additional explanation.';

	return await llms().medium.generateText(prompt, { id: 'Slack blocks to Markdown', thinking: 'none' });
}

/**
 * Mutates the messages in place, updating the user ids with the user profiles
 */
function updateMessageUserIdsWithProfile(messages: MessageElement[], users: Map<string, SlackUser>): void {
	for (const message of messages) {
		// Update top-level user field
		if (message.user && typeof message.user === 'string') {
			const user = users.get(message.user);
			if (user) {
				// Replace with readable name or keep full user object if you need more info
				message.user = user.displayName || user.realName || user.name || message.user;
			}
		}

		// Update user mentions in text field
		if (message.text) {
			message.text = replaceUserMentionsInText(message.text, users);
		}

		// Update user references in blocks
		if (message.blocks) {
			updateBlocksUserReferences(message.blocks, users);
		}
	}
}

function replaceUserMentionsInText(text: string, users: Map<string, SlackUser>): string {
	// Replace <@USER_ID> with @DisplayName
	return text.replace(/<@([A-Z0-9]+)>/g, (match, userId) => {
		const user = users.get(userId);
		if (user) {
			const name = user.displayName || user.realName || user.name;
			return `@${name}`;
		}
		return match;
	});
}

function updateBlocksUserReferences(blocks: any[], users: Map<string, SlackUser>): void {
	for (const block of blocks) {
		if (block.elements) {
			updateBlockElements(block.elements, users);
		}
	}
}

function updateBlockElements(elements: any[], users: Map<string, SlackUser>): void {
	for (const element of elements) {
		// Handle user type elements
		if (element.type === 'user' && element.user_id) {
			const user = users.get(element.user_id);
			if (user) {
				const name = user.displayName || user.realName || user.name;
				// Convert to text mention for clearer markdown conversion
				element.type = 'text';
				element.text = `@${name}`;
				element.user_id = undefined;
			}
		}

		// Handle text elements with user mentions
		if (element.text && typeof element.text === 'string') {
			element.text = replaceUserMentionsInText(element.text, users);
		}

		// Recursively handle nested elements (rich_text has nested structures)
		if (element.elements && Array.isArray(element.elements)) {
			updateBlockElements(element.elements, users);
		}
	}
}
