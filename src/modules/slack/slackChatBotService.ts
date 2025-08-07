import { App, type KnownEventFromType, type SayFn, StringIndexed } from '@slack/bolt';
import { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import { getLastFunctionCallArg } from '#agent/autonomous/agentCompletion';
import { AgentExecution, resumeCompleted, resumeCompletedWithUpdatedUserRequest, startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { appContext } from '#app/applicationContext';
import { GoogleCloud } from '#functions/cloud/google/google-cloud';
import { Jira } from '#functions/jira';
import { LlmTools } from '#functions/llmTools';
import { GitLab } from '#functions/scm/gitlab';
import { Perplexity } from '#functions/web/perplexity';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { type AgentCompleted, type AgentContext, isExecuting } from '#shared/agent/agent.model';
import { sleep } from '#utils/async-utils';
import type { ChatBotService } from '../../chatBot/chatBotService';
import { SlackAPI } from './slackApi';
import { textToBlocks } from './slackMessageFormatter';

let slackApp: App<StringIndexed> | undefined;

const CHATBOT_FUNCTIONS: Array<new () => any> = [GitLab, GoogleCloud, Perplexity, LlmTools, Jira];

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
	appChannel = '';
	slackApi: SlackAPI | undefined;

	private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

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

		if (agent.metadata.slack.reply_ts) this.api().removeReaction(agent.metadata.slack.channel, agent.metadata.slack.reply_ts, 'robot_face');

		const params: any = {
			channel: agent.metadata.slack.channel,
			thread_ts: agent.metadata.slack.thread_ts,
			blocks: textToBlocks(message),
		};

		// TODO remove reaction from message it replied to

		/* Only add thread_ts if we’re in a real thread.
			 - In a channel: event.thread_ts is set for replies
			 - In the App DM: event.thread_ts is undefined  */
		// if (agent.metadata.thread_ts) {
		// 	params.thread_ts = agent.metadata.thread_ts;
		// }

		try {
			const result = await slackApp.client.chat.postMessage(params);

			if (!result.ok) throw new Error(`Failed to send message to Slack: ${result.error}`);
		} catch (error) {
			logger.error(error, 'Error sending message to Slack');
			throw error;
		}
	}

	async shutdown() {
		await slackApp?.stop();
		slackApp = undefined;
	}

	async initSlack(): Promise<void> {
		if (slackApp) return;

		const botToken = process.env.SLACK_BOT_TOKEN;
		const signingSecret = process.env.SLACK_SIGNING_SECRET;
		this.appChannel = process.env.SLACK_APP_CHANNEL;
		const channels = process.env.SLACK_CHANNELS;
		const appToken = process.env.SLACK_APP_TOKEN;

		if (!botToken || !signingSecret || !channels || !appToken) {
			logger.error('Slack chatbot requires environment variables SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN and SLACK_CHANNELS');
		}

		this.slackApi = new SlackAPI();

		// Initializes your app with your bot token and signing secret
		slackApp = new App({
			token: botToken,
			signingSecret: signingSecret,
			socketMode: true, // enable to use socket mode
			appToken: appToken,
		});

		this.channels = new Set([...channels.split(',').map((s) => s.trim())]);

		// Listen for messages in channels
		slackApp.event('message', async ({ event, say }) => {
			this.handleMessage(event, say);
		});

		slackApp.event('app_mention', async ({ event, say }) => {
			console.log('app_mention received');
			console.log(event);
			// TODO if not in a channel we are subscribed to, then get the thread messages and reply to it
		});

		await slackApp.start();

		logger.info('Registered event listener');

		await sleep(300000);
	}

	async handleMessage(event: KnownEventFromType<'message'>, say: SayFn) {
		// biomejs formatter changes event['property'] to event.property which doesn't compile
		const _event: any = event;
		const threadId = _event.thread_ts ?? _event.ts;
		const agentId = `Slack-${threadId}`;
		const agentService = appContext().agentStateService;
		logger.debug(event, 'Slack message received [event]');

		if (event.subtype === 'message_deleted') return;
		if (event.subtype === 'message_changed') return;
		if (event.subtype === 'channel_join') return;
		if (event.subtype) console.log(`Event subtype: ${event.subtype}`);

		// Check if the message is in the desired channel
		if (!this.channels.has(event.channel) && event.channel_type !== 'im') {
			logger.info(`Channel ${event.channel} not configured`);
			return;
		}

		const text = _event.text;

		// In regular channels if the message is not a reply in a thread, then we will start a new agent to handle the first message in the thread
		if (!_event.thread_ts) {
			// New top-level message (new thread) in any channel type
			const threadId = event.ts;
			logger.info(`New thread ${event.ts}`);

			await this.slackApi.addReaction(event.channel, threadId, 'robot_face');

			try {
				const agentExec = await this.startAgentForThread(threadId, event.channel, text);
				await agentExec.execution;
				const agent: AgentContext = await agentService.load(agentExec.agentId);
				if (agent.state !== 'completed' && agent.state !== 'hitl_feedback') {
					logger.error(`Agent did not complete. State was ${agent.state}`);
					await this.slackApi.addReaction(event.channel, event.ts, 'robot_face::boom');
					return;
				}
				return;
			} catch (e) {
				logger.error(e, 'Error handling new Slack thread');
			}
		} else {
			// Otherwise this is a reply to a thread
			const threadId = _event.thread_ts;
			const agentId = `Slack-${threadId}`;
			const agent: AgentContext | null = await agentService.load(agentId);
			const messages = await this.fetchThreadMessages(event.channel, threadId);

			await this.slackApi.addReaction(event.channel, _event.ts, 'robot_face');

			const prompt = `${JSON.stringify(messages)}\n\nReply to this conversation thread`;

			if (!agent) {
				this.startAgentForThread(threadId, event.channel, prompt, _event.ts);
			} else if (isExecuting(agent)) {
				// TODO make this transactional, and implement
				agent.pendingMessages.push(_event.text);
				await agentService.save(agent);
				return;
			} else {
				await resumeCompletedWithUpdatedUserRequest(agentId, agent.executionId, prompt);
			}
		}
	}

	async startAgentForThread(threadId: string, channel: string, prompt: string, replyTs?: string): Promise<AgentExecution> {
		return await startAgent({
			type: 'autonomous',
			subtype: 'codegen',
			resumeAgentId: `Slack-${threadId}`,
			initialPrompt: prompt,
			llms: defaultLLMs(),
			functions: CHATBOT_FUNCTIONS,
			agentName: `Slack-${threadId}`,
			systemPrompt:
				'You are an AI support agent.  You are responding to support requests on the company Slack account. Respond in a helpful, concise manner. If you encounter an error responding to the request do not provide details of the error to the user, only respond with "Sorry, I\'m having difficulties providing a response to your request"',
			metadata: { slack: { channel, thread_ts: threadId, reply_ts: replyTs } }, // Use event.ts as thread_ts for new threads
			completedHandler: this,
			humanInLoop: {
				budget: 2,
				count: 10,
			},
		});
	}

	async fetchThreadMessages(channel: string, parentMessageTs: string): Promise<any> {
		const result = await slackApp.client.conversations.replies({
			ts: parentMessageTs,
			channel,
			limit: 1000,
		});

		const messages: MessageElement[] = result.messages;

		if (result.has_more) {
			const nextResult = await slackApp.client.conversations.replies({
				ts: parentMessageTs,
				cursor: result.response_metadata.next_cursor,
				channel,
			});
			messages.push(...nextResult.messages);
		}
		return messages;
	}
}
