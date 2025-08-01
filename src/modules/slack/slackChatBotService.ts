import { App, type KnownEventFromType, type SayFn, StringIndexed } from '@slack/bolt';
import { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import { getLastFunctionCallArg } from '#agent/autonomous/agentCompletion';
import { resumeCompleted, resumeCompletedWithUpdatedUserRequest, startAgent } from '#agent/autonomous/autonomousAgentRunner';
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
	slackApi: SlackAPI;

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

		const params: any = {
			channel: agent.metadata.channel,
			text: message,
			thread_ts: agent.metadata.thread_ts,
		};

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

		this.channels = new Set([this.appChannel, ...channels.split(',').map((s) => s.trim())]);

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
		console.log('Event received for message');
		console.log('== BEGIN EVENT ==');
		console.log(JSON.stringify(event));
		console.log('== END EVENT ==');
		logger.info(`channel_type: ${event.channel_type}`);
		// logger.info(await (say['message']))
		const _say: SayFn = say;

		// if (event.channel_type === 'im')
		if (event.subtype === 'message_deleted') return;
		if (event.subtype === 'message_changed') return;
		if (event.subtype === 'channel_join') return;
		if (event.subtype) console.log(`Event subtype: ${event.subtype}`);

		// Check if the message is in the desired channel
		if (!this.channels.has(event.channel) && event.channel_type !== 'im') {
			logger.info(`Channel ${event.channel} not configured`);
			return;
		}

		console.log(`Message received in channel: ${_event.text}`);

		const agentService = appContext().agentStateService;

		// Messages with the app under the Apps section has different properties than messages from a regular channel?
		if (event.channel === this.appChannel) {
			const threadTs = (event as any).thread_ts;
			const newThread = event.ts === threadTs;
			let conversationHistory = '';

			if (!newThread) {
				const threadMessages = await new SlackAPI().getConversationReplies(event.channel, threadTs);
				conversationHistory = `You are the bot and will be responding to the user.\n<conversation-history>${threadMessages.map((message) => {
					const tagName = message.bot_profile ? 'bot' : 'user';
					return `<${tagName}>\n${message.text}\n</${tagName}>\n`;
				})}</conversation-history>\n\n`;
			}

			try {
				const agentExec = await startAgent({
					type: 'autonomous',
					subtype: 'codegen',
					resumeAgentId: 'Slack-app',
					initialPrompt: conversationHistory + _event.text,
					llms: defaultLLMs(),
					functions: CHATBOT_FUNCTIONS,
					agentName: 'Slack-app',
					systemPrompt:
						'You are an AI support agent.  You are responding to support requests on the company Slack account. Respond in a helpful, concise manner. If you encounter an error responding to the request do not provide details of the error to the user, only respond with "Sorry, I\'m having difficulties providing a response to your request"',
					metadata: { channel: event.channel, thread_ts: event.ts },
					completedHandler: this,
					humanInLoop: {
						budget: 0.5,
						count: 5,
					},
				});
				await agentExec.execution;
				const agent: AgentContext = await appContext().agentStateService.load(agentExec.agentId);
				if (agent.state !== 'completed' && agent.state !== 'hitl_feedback') {
					logger.error(`Agent did not complete. State was ${agent.state}`);

					await this.slackApi.addReaction(event.channel, event.ts, 'robot_face::boom');

					return;
				}
			} catch (e) {
				logger.error(e, 'Error handling new Slack app thread');
			}
			return;
		}

		// In regular channels if the message is not a reply in a thread, then we will start a new agent to handle the first message in the thread
		if (!_event.thread_ts) {
			const threadId = event.ts;
			logger.info(`New thread ${event.ts}`);

			const text = _event.text;

			try {
				const ackResult = await say({
					text: "One moment, I'm analysing your request",
					thread_ts: threadId,
					channel: event.channel,
				});
				if (!ackResult.ok) {
					logger.error(ackResult.error, 'Error sending Slack acknowledgement');
				}
			} catch (e) {
				logger.error(e, 'Error sending Slack acknowledgement');
			}

			try {
				const agentExec = await startAgent({
					type: 'autonomous',
					subtype: 'codegen',
					resumeAgentId: `Slack-${threadId}`,
					initialPrompt: text,
					llms: defaultLLMs(),
					functions: CHATBOT_FUNCTIONS,
					agentName: `Slack-${threadId}`,
					systemPrompt:
						'You are an AI support agent.  You are responding to support requests on the company Slack account. Respond in a helpful, concise manner. If you encounter an error responding to the request do not provide details of the error to the user, only respond with "Sorry, I\'m having difficulties providing a response to your request"',
					metadata: { channel: event.channel },
					completedHandler: this,
					humanInLoop: {
						budget: 0.5,
						count: 5,
					},
				});
				await agentExec.execution;
				const agent: AgentContext = await appContext().agentStateService.load(agentExec.agentId);
				if (agent.state !== 'completed' && agent.state !== 'hitl_feedback') {
					logger.error(`Agent did not complete. State was ${agent.state}`);
					return;
				}
				return;
				// Agent completionHandler sends the message
				// const response = agent.functionCallHistory.at(-1).parameters[agent.state === 'completed' ? AGENT_COMPLETED_PARAM_NAME : REQUEST_FEEDBACK_PARAM_NAME];
				// const sayResult = await say({
				// 	text: response,
				// 	thread_ts: threadId,
				// 	channel: event.channel,
				// });
				// if (!sayResult.ok) {
				// 	logger.error(sayResult.error, 'Error replying');
				// }
			} catch (e) {
				logger.error(e, 'Error handling new Slack thread');
			}
		} else {
			// Otherwise this is a reply to a thread
			const agentId = `Slack-${_event.thread_ts}`;
			const agent: AgentContext | null = await agentService.load(agentId);
			// Getting a null agent when a conversation is started in the App channel - handle in the app specific code
			if (agent && isExecuting(agent)) {
				// TODO make this transactional, and implement
				agent.pendingMessages.push(_event.text);
				await agentService.save(agent);
				return;
			}
			const messages = await this.fetchThreadMessages(event.channel, _event.thread_ts);
			await resumeCompletedWithUpdatedUserRequest(
				agentId,
				agent.executionId,
				`${JSON.stringify(messages)}\n\nYour task is to reply to this conversation thread`,
			);
		}
	}

	async fetchThreadMessages(channel: string, parentMessageTs: string): Promise<any> {
		const result = await slackApp.client.conversations.replies({
			ts: parentMessageTs,
			channel,
			limit: 1000, // Maximum number of messages to return
		});

		// Process the messages
		const messages: MessageElement[] = result.messages;

		// If there are more messages, use pagination
		if (result.has_more) {
			// Fetch the next page of messages
			const nextResult = await slackApp.client.conversations.replies({
				ts: parentMessageTs,
				cursor: result.response_metadata.next_cursor,
				channel,
			});
			// Process the next page of messages
			messages.push(...nextResult.messages);
		}
		return messages;
	}
}
