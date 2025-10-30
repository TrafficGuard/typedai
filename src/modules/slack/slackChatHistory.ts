import { WebClient } from '@slack/web-api';
import { slackConfig } from './slackConfig';

type SlackConversation = {
	id: string;
	name?: string;
	is_channel?: boolean;
	is_group?: boolean;
	is_im?: boolean;
	is_mpim?: boolean;
};

// const config = slackConfig();

const token = process.env.SLACK_USER_TOKEN;
if (!token) {
	throw new Error('SLACK_USER_TOKEN is not set');
}

const client = new WebClient(token);

/**
 * Get all conversations the authenticated user has participated in during the last 24 hours.
 * This function:
 * - Lists all conversations (channels, groups, im, mpim) the token can access
 * - For each conversation, fetches recent messages and checks if any message is within last 24h
 * - Returns a map of conversation IDs to their latest relevant message timestamps
 *
 * "User Token Scopes" section (NOT Bot Token Scopes)
 * Click "Add an OAuth Scope" and add these scopes:
 * channels:read
 * channels:history
 * groups:read
 * groups:history
 * im:read
 * im:history
 * mpim:read
 * mpim:history
 */
async function getParticipatedConversationsLast24h(): Promise<Map<string, SlackConversation>> {
	const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
	const since = Math.floor((Date.now() - TWENTY_FOUR_HOURS_MS) / 1000); // Slack ts are in seconds
	const sinceStr = since.toString(); // Convert to string for Slack API

	const participated = new Map<string, SlackConversation>();

	// 1) List conversations the token can access
	let cursor: string | undefined = undefined;
	do {
		const resp = await client.conversations.list({
			exclude_archived: true,
			types: 'public_channel,private_channel,im,mpim',
			limit: 1000,
			cursor,
		});

		const conversations = resp.channels ?? [];

		// 2) For each conversation, fetch recent messages and see if any ts >= since
		for (const c of conversations) {
			const id = c.id;
			if (!id) continue; // Skip if id is undefined

			console.log(c);
			// Track a quick heuristic: if the conversation name exists, store it
			const convo: SlackConversation = {
				id,
				name: (c.name || c.is_im ? undefined : c.name) as string | undefined,
				is_channel: c.is_channel,
				is_group: c.is_group,
				is_im: c.is_im,
				is_mpim: c.is_mpim,
			};

			// Fetch recent messages in this conversation
			// We fetch the most recent 100 messages; adjust as needed
			try {
				const hist = await client.conversations.history({
					channel: id,
					limit: 100,
					inclusive: true,
					oldest: sinceStr, // Use string instead of number
				});

				const messages = hist.messages ?? [];
				console.log(messages);
				const hasRecent = messages.some((m) => {
					// Some messages may be from bots or app mentions; still consider
					const ts = typeof m.ts === 'string' ? Number.parseFloat(m.ts) : 0;
					return ts >= since;
				});

				if (hasRecent) {
					participated.set(id, convo);
				}
			} catch (err) {
				// If history is not accessible (e.g., inadequate scope), skip this convo
				// eslint-disable-next-line no-console
				console.warn(`Skipping convo ${id} due to history access issue:`, (err as Error).message);
			}
		}

		cursor = resp.response_metadata?.next_cursor ?? undefined;
	} while (cursor);

	return participated;
}

// Example usage
(async () => {
	try {
		const results = await getParticipatedConversationsLast24h();
		// Output: list of conversations with IDs and basic metadata
		for (const [id, convo] of results) {
			console.log(`Participated: ${id} ${convo.name ?? '(unnamed)'} (IM/MPIM: ${Boolean(convo.is_im || convo.is_mpim)})`);
		}
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error('Error fetching participation data:', (e as Error).message);
	}
})();
