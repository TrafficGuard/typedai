import { App, type KnownEventFromType, type SayFn, StringIndexed } from '@slack/bolt';
import { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import { Member } from '@slack/web-api/dist/types/response/UsersListResponse';
import { llms } from '#agent/agentContextUtils';
import { AgentExecution, isAgentExecuting } from '#agent/agentExecutions';
import { getLastFunctionCallArg } from '#agent/autonomous/agentCompletion';
import { resumeCompletedWithUpdatedUserRequest, startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { registerCompletedHandler } from '#agent/completionHandlerRegistry';
import { appContext } from '#app/applicationContext';
import { GoogleCloud } from '#functions/cloud/google/google-cloud';
import { Confluence } from '#functions/confluence';
import { Jira } from '#functions/jira';
import { LlmTools } from '#functions/llmTools';
import { GitLab } from '#functions/scm/gitlab';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { getAgentUser } from '#routes/webhooks/webhookAgentUser';
import { type AgentCompleted, type AgentContext } from '#shared/agent/agent.model';
import type { User } from '#shared/user/user.model';
import { runAsUser } from '#user/userContext';
import type { ChatBotService } from '../../chatBot/chatBotService';
import { SupportKnowledgebase } from '../../functions/supportKnowledgebase';
import { SlackAPI } from './slackApi';
import { convertMessageBlocksToMarkdown } from './slackBlocksToText';
import { slackConfig } from './slackConfig';

let slackApp: App<StringIndexed> | undefined;

const CHATBOT_FUNCTIONS: Array<new () => any> = [GitLab, GoogleCloud, PublicWeb, Perplexity, LlmTools, Jira, Confluence];

const SUPPORT_PROMPT = `You are TG AI, the AI support agent in the company Slack channels. Always read the entire thread before acting.

Calling the Agent_completed function with a note will post the note contents as a message to the conversation.
Calling the Agent_completed function with an empty string will not post a message to the conversation.

Deciding whether to respond:
- Reply when you can clearly add value: a participant has asked a question, tagged you, or left an issue unresolved, and you have high-confidence, non-duplicative information that moves it forward.
- This still applies if new messages were added after the question—respond to the outstanding item as long as it remains unresolved and your answer is still relevant.
- If you have been tagged in a message that you haven't yet replied to, then provide a reply referencing the message you were tagged in, either providing what you know about the issue or informing that you're unable to help with it.
- If the conversation has shifted to human-only updates, celebrations, or already solved the issue without requesting further input, do not reply, i.e. call the Agent_completed function with an empty string.

When you do reply:
- Be concise, actionable, and back up guidance with concrete evidence (commands, URLs, logs) when available.
- Acknowledge uncertainty rather than guessing; never fabricate information.
- If you encounter an internal problem generating a response, reply only with “Sorry, I'm having difficulties providing a response to your request.”`;

export interface SlackUser {
	name: string;
	isBot: boolean;
	deleted: boolean;
	realName: string;
	displayName: string;
	realNameNormalized: string;
	displayNameNormalized: string;
	email: string;
}

/*
There's a few steps involved with spotting a thread and then understanding the context of a message within it. Let's unspool them:

1. Detect a threaded message by looking for a thread_ts value in the message object. The existence of such a value indicates that the message is part of a thread.
2. Identify parent messages by comparing the thread_ts and ts values. If they are equal, the message is a parent message.
3. Threaded replies are also identified by comparing the thread_ts and ts values. If they are different, the message is a reply.

One quirk of threaded messages is that a parent message object will retain a thread_ts value, even if all its replies have been deleted.
*/

/**
 * Slack implementation of ChatBotService
 * Only one Slack workspace can be configured in the application as the Slack App is shared between all instances of this class.
 */
export class SlackChatBotService implements ChatBotService, AgentCompleted {
	channels: Set<string> = new Set();
	slackApi: SlackAPI | undefined;
	status: 'disconnected' | 'connected' = 'disconnected';

	private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
	private agentUser!: User;
	private botUserId: string | undefined;
	private botMentionCache: Map<string, boolean> = new Map(); // Cache bot mentions by thread
	private users: Map<string, SlackUser> = new Map();

	api(): SlackAPI {
		this.slackApi ??= new SlackAPI();
		return this.slackApi;
	}

	threadId(agent: AgentContext): string {
		return agent.agentId.replace('Slack-', '');
	}

	agentCompletedHandlerId(): string {
		return 'slack-bot';
	}

	notifyCompleted(agent: AgentContext): Promise<void> {
		let message = '';
		switch (agent.state) {
			case 'error':
				message = `Sorry, I'm having unexpected difficulties providing a response to your request`;
				break;
			case 'hitl_threshold':
				message = `Apologies, I've been unable to produce a response with the resources I've been allocated to spend on the request`;
				break;
			case 'hitl_feedback':
				message = getLastFunctionCallArg(agent);
				break;
			case 'completed':
				message = getLastFunctionCallArg(agent);
				break;
			default:
				message = `Sorry, I'm unable to provide a response to your request`;
		}
		return this.sendMessage(agent, message);
	}

	/**
	 * Sends a message to the chat thread the agent is a chatbot for.
	 * @param agent
	 * @param message
	 */
	async sendMessage(agent: AgentContext, message: string): Promise<void> {
		if (!slackApp) throw new Error('Slack app is not initialized. Call initSlack() first.');

		if (!agent.metadata?.slack?.channel || !agent.metadata?.slack?.thread_ts) {
			logger.error({ metadata: agent.metadata }, `Agent ${agent.agentId} does not have a Slack channel and thread_ts metadata [metadata]`);
			return;
		}

		/* Only add thread_ts if we're in a real thread.
			 - In a channel: event.thread_ts is set for replies
			 - In the App DM: event.thread_ts is undefined  */
		// if (agent.metadata.thread_ts) {
		// 	params.thread_ts = agent.metadata.thread_ts;
		// }
		const replyTs = agent.metadata.slack.reply_ts;
		const channelId = agent.metadata.slack.channel;
		const threadTs = agent.metadata.slack.thread_ts;
		try {
			this.api().postMessage(channelId, threadTs, message, replyTs);
			if (replyTs) this.api().removeReaction(channelId, replyTs, 'robot_face');
		} catch (e) {
			logger.error(e, 'Error sending message to Slack');
			if (replyTs) this.api().addReaction(channelId, replyTs, 'robot_face::boom');
		}
	}

	async shutdown() {
		await slackApp?.stop();
		slackApp = undefined;
		this.status = 'disconnected';
		this.channels.clear();
		this.botUserId = undefined;
		this.botMentionCache.clear();
	}

	async initSlack(startSocketListener = false): Promise<void> {
		if (slackApp) {
			logger.warn('Slack app already initialized');
			return;
		}

		this.agentUser = await getAgentUser();
		this.slackApi = new SlackAPI();

		// Initializes your app with your bot token and signing secret
		const config = slackConfig();
		slackApp = new App({
			token: config.botToken,
			signingSecret: config.signingSecret,
			socketMode: config.socketMode,
			appToken: config.appToken,
		});

		this.channels = new Set(config.channels);

		const members = await this.slackApi.getUsers();
		for (const member of members) {
			if (!member.id) continue;
			this.users.set(member.id, {
				name: member.name || '',
				isBot: member.is_bot || false,
				deleted: member.deleted || false,
				realName: member.profile?.real_name || '',
				displayName: member.profile?.display_name || '',
				realNameNormalized: member.profile?.real_name_normalized || '',
				displayNameNormalized: member.profile?.display_name_normalized || '',
				email: member.profile?.email || '',
			});
		}

		// Get bot user ID for mention detection
		try {
			const authResult = await slackApp.client.auth.test();
			this.botUserId = authResult.user_id;
			logger.info({ botUserId: this.botUserId }, 'Bot user ID retrieved');
		} catch (error) {
			logger.error(error, 'Failed to get bot user ID');
		}

		if (config.socketMode && (config.autoStart || startSocketListener === true)) {
			// Listen for messages in channels
			slackApp.event('message', async ({ event, say }) => {
				this.handleMessage(event, say);
			});

			slackApp.event('app_mention', async ({ event, say }) => {
				logger.info({ event }, 'app_mention received');
				// Cache that the bot was mentioned in this thread
				const threadTs = (event as any).thread_ts || event.ts;
				const cacheKey = `${event.channel}-${threadTs}`;
				this.botMentionCache.set(cacheKey, true);
			});
			logger.info('Registered Slack event listeners');
		}

		await slackApp.start();

		this.status = 'connected';
	}

	async handleMessage(event: KnownEventFromType<'message'>, say: SayFn) {
		await runAsUser(this.agentUser, async () => {
			try {
				await this.processMessage(event, say);
			} catch (error) {
				logger.error(error, 'Error processing Slack message');
				await this.api().addReaction(event.channel, event.ts, 'robot_face::boom');
			}
		});
	}

	private messageMentionsBot(messageText: string): boolean {
		if (!this.botUserId || !messageText) return false;
		return messageText.includes(`<@${this.botUserId}>`);
	}

	private async isBotMentionedInThread(channel: string, threadTs: string): Promise<boolean> {
		const cacheKey = `${channel}-${threadTs}`;
		// Check cache first
		if (this.botMentionCache.has(cacheKey)) return this.botMentionCache.get(cacheKey)!;

		if (!this.botUserId) {
			logger.warn('Bot user ID not available for mention detection');
			return false;
		}

		try {
			const messages = await this.api().fetchThreadMessages(channel, threadTs);
			// Check if any message in the thread mentions the bot
			const mentioned = messages.some((msg: any) => this.messageMentionsBot(msg.text));
			// Cache the result
			this.botMentionCache.set(cacheKey, mentioned);
			return mentioned;
		} catch (error) {
			logger.error(error, 'Error checking for bot mention in thread');
			return false;
		}
	}

	private async processMessage(event: KnownEventFromType<'message'>, say: SayFn) {
		// biomejs formatter changes event['property'] to event.property which doesn't compile
		const _event: any = event;
		const agentService = appContext().agentStateService;
		logger.info({ event }, 'Slack message received');

		if (event.subtype === 'message_deleted') return;
		if (event.subtype === 'message_changed') return;
		if (event.subtype === 'channel_join') return;

		const messageText = _event.text;
		const isConfiguredChannel = this.channels.has(event.channel);
		const isDM = event.channel_type === 'im';
		const currentMessageMentionsBot = this.messageMentionsBot(messageText);

		// Quick check: if it's not a configured channel, not a DM, and current message doesn't mention bot
		if (!isConfiguredChannel && !isDM && !currentMessageMentionsBot) {
			// If it's a reply in a thread, check if bot was mentioned earlier in the thread
			if (_event.thread_ts) {
				const botMentionedInThread = await this.isBotMentionedInThread(event.channel, _event.thread_ts);
				if (!botMentionedInThread) {
					logger.info(`Ignoring message in channel ${event.channel} - not configured, not a DM, and bot not mentioned`);
					return;
				}
			} else {
				logger.info(`Ignoring message in channel ${event.channel} - not configured, not a DM, and bot not mentioned`);
				return;
			}
		}

		// Cache bot mention if current message mentions bot
		if (currentMessageMentionsBot) {
			const threadTs = _event.thread_ts || event.ts;
			const cacheKey = `${event.channel}-${threadTs}`;
			this.botMentionCache.set(cacheKey, true);
		}

		// In regular channels if the message is not a reply in a thread, then we will start a new agent to handle the first message in the thread
		if (!_event.thread_ts) {
			const threadId = event.ts;
			logger.info(`New thread ${event.ts}`);

			await this.api().addReaction(event.channel, threadId, 'robot_face');

			try {
				let enrichedMessageText: string | undefined;
				try {
					const blocks = JSON.parse(messageText);
					if (Array.isArray(blocks)) {
						enrichedMessageText = await convertMessageBlocksToMarkdown(blocks, this.users);
					} else {
						logger.info({ messageText }, 'Message text is not an array of blocks');
					}
				} catch (e) {
					logger.info(e, 'Unable to enrich message text with user profiles');
				}

				const agentExec = await this.startAgentForThread(threadId, event.channel, enrichedMessageText || messageText);
				await agentExec.execution;
				const agent: AgentContext = (await agentService.load(agentExec.agentId))!;

				if (agent.state !== 'completed' && agent.state !== 'hitl_feedback') {
					logger.error(`Agent did not complete. State was ${agent.state}`);
					await this.api().addReaction(event.channel, event.ts, 'robot_face::boom');
					return;
				}
				await this.api().removeReaction(event.channel, event.ts, 'robot_face');
				return;
			} catch (e) {
				logger.error(e, 'Error handling new Slack thread');
			}
		} else {
			// Otherwise this is a reply to a thread
			logger.info(`Reply to thread ${event.ts}`);
			const threadId = _event.thread_ts;
			const agentId = `Slack-${threadId}`;
			let agent: AgentContext | null = await agentService.load(agentId);
			const messagesBlocks = await this.api().fetchThreadMessages(event.channel, threadId);

			const messages = await convertMessageBlocksToMarkdown(messagesBlocks, this.users);

			await this.api().addReaction(event.channel, _event.ts, 'robot_face');

			const prompt = `${messages}\n\n------\n\nReply to this conversation thread, if appropriate. If `;

			if (!agent) {
				logger.info(`Starting new agent for thread ${threadId}`);
				const exec = await this.startAgentForThread(threadId, event.channel, prompt, _event.ts);
				await exec.execution;
			} else if (isAgentExecuting(agentId)) {
				logger.info(`Adding message to agent ${agentId}`);
				// TODO need to do this update in a transaction
				agent = await agentService.load(agentId);
				if (!agent) return;
				agent.pendingMessages.push(_event.text);
				await agentService.save(agent);
				return;
			} else {
				logger.info(`Resuming completed agent ${agentId}`);
				const exec = await resumeCompletedWithUpdatedUserRequest(agentId, agent.executionId, prompt);
				await exec.execution;
			}
			await this.api().removeReaction(event.channel, event.ts, 'robot_face');
		}
	}

	async startAgentForThread(threadId: string, channel: string, prompt: string, replyTs?: string): Promise<AgentExecution> {
		const supportFuncs = new SupportKnowledgebase();

		return await startAgent({
			type: 'autonomous',
			subtype: 'codegen',
			resumeAgentId: `Slack-${threadId}`,
			initialPrompt: prompt,
			llms: defaultLLMs(),
			functions: CHATBOT_FUNCTIONS,
			agentName: `Slack-${threadId}`,
			metadata: { slack: { channel, thread_ts: threadId, reply_ts: replyTs } }, // Use event.ts as thread_ts for new threads
			completedHandler: this,
			useSharedRepos: true, // Support bot is read only
			humanInLoop: {
				budget: 3,
				count: 15,
			},
			initialMemory: {
				'core-documentation': await supportFuncs.getCoreDocumentation(),
				'initial-knowledgebase-search-results': await supportFuncs.searchDocs(prompt),
			},
		});
	}

	// async convertMessageBlocksToMarkdown(message: string, users: Map<string, SlackUser>): Promise<string> {
	// 	let prompt = `<slack-messages>\n${message}\n</slack-messages>\n\n`;
	// 	prompt += 'Convert the Slack message blocks into markdown format, preserving any code blocks, links, formatting etc.\n';
	// 	prompt += 'Return only the markdown content without any additional explanation.';

	// 	return await llms().medium.generateText(prompt, { id: 'Slack blocks to Markdown', thinking: 'none' });
	// }

	// /**
	//  * Mutates the messages in place, updating the user ids with the user profiles
	//  */
	// updateMessageUserIdsWithProfile(messages: MessageElement[]): void {
	// 	for (const message of messages) {
	// 		// Update top-level user field
	// 		if (message.user && typeof message.user === 'string') {
	// 			const user = this.users.get(message.user);
	// 			if (user) {
	// 				// Replace with readable name or keep full user object if you need more info
	// 				message.user = user.displayName || user.realName || user.name || message.user;
	// 			}
	// 		}

	// 		// Update user mentions in text field
	// 		if (message.text) {
	// 			message.text = this.replaceUserMentionsInText(message.text);
	// 		}

	// 		// Update user references in blocks
	// 		if (message.blocks) {
	// 			this.updateBlocksUserReferences(message.blocks);
	// 		}
	// 	}
	// }

	// private replaceUserMentionsInText(text: string): string {
	// 	// Replace <@USER_ID> with @DisplayName
	// 	return text.replace(/<@([A-Z0-9]+)>/g, (match, userId) => {
	// 		const user = this.users.get(userId);
	// 		if (user) {
	// 			const name = user.displayName || user.realName || user.name;
	// 			return `@${name}`;
	// 		}
	// 		return match;
	// 	});
	// }

	// private updateBlocksUserReferences(blocks: any[]): void {
	// 	for (const block of blocks) {
	// 		if (block.elements) {
	// 			this.updateBlockElements(block.elements);
	// 		}
	// 	}
	// }

	// private updateBlockElements(elements: any[]): void {
	// 	for (const element of elements) {
	// 		// Handle user type elements
	// 		if (element.type === 'user' && element.user_id) {
	// 			const user = this.users.get(element.user_id);
	// 			if (user) {
	// 				const name = user.displayName || user.realName || user.name;
	// 				// Convert to text mention for clearer markdown conversion
	// 				element.type = 'text';
	// 				element.text = `@${name}`;
	// 				element.user_id = undefined;
	// 			}
	// 		}

	// 		// Handle text elements with user mentions
	// 		if (element.text && typeof element.text === 'string') {
	// 			element.text = this.replaceUserMentionsInText(element.text);
	// 		}

	// 		// Recursively handle nested elements (rich_text has nested structures)
	// 		if (element.elements && Array.isArray(element.elements)) {
	// 			this.updateBlockElements(element.elements);
	// 		}
	// 	}
	// }
}

registerCompletedHandler(new SlackChatBotService());
