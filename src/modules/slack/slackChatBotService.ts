import { App, KnownEventFromType, SayFn } from '@slack/bolt';
import { StringIndexed } from '@slack/bolt/dist/types/helpers';
import { MessageElement } from '@slack/web-api/dist/response/ConversationsRepliesResponse';
import { getLastFunctionCallArg } from '#agent/agentCompletion';
import { AgentCompleted, AgentContext, isExecuting } from '#agent/agentContextTypes';
import { resumeCompleted, resumeCompletedWithUpdatedUserRequest, startAgent } from '#agent/agentRunner';
import { GoogleCloud } from '#functions/cloud/google/google-cloud';
import { Jira } from '#functions/jira';
import { GitLab } from '#functions/scm/gitlab';
import { LlmTools } from '#functions/util';
import { Perplexity } from '#functions/web/perplexity';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { sleep } from '#utils/async-utils';
import { appContext } from '../../applicationContext';
import { ChatBotService } from '../../chatBot/chatBotService';

let slackApp: App<StringIndexed> | undefined;

const CHATBOT_FUNCTIONS: Array<new () => any> = [GitLab, GoogleCloud, Perplexity, LlmTools, Jira];

/**
 * Slack implementation of ChatBotService
 * Only one Slack workspace can be configured in the application as the Slack App is shared between all instances of this class.
 */
export class SlackChatBotService implements ChatBotService, AgentCompleted {
	channels: Set<string> = new Set();

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
			case 'hil':
				message = `Apologies, I've been unable to produce a response with the resources I've been allocated to spend on the request`;
				break;
			case 'feedback':
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

		logger.info(`Sending slack message:  ${message}`);
		const threadId = this.threadId(agent);

		try {
			const result = await slackApp.client.chat.postMessage({
				text: message,
				thread_ts: threadId,
				channel: agent.metadata.channel,
			});

			if (!result.ok) {
				throw new Error(`Failed to send message to Slack: ${result.error}`);
			}
		} catch (error) {
			logger.error(error, 'Error sending message to Slack');
			throw error;
		}
	}

	async initSlack(): Promise<void> {
		if (slackApp) return;

		const botToken = process.env.SLACK_BOT_TOKEN;
		const signingSecret = process.env.SLACK_SIGNING_SECRET;
		const channels = process.env.SLACK_CHANNELS;
		const appToken = process.env.SLACK_APP_TOKEN;

		if (!botToken || !signingSecret || !channels || !appToken) {
			logger.error('Slack chatbot requires environment variables SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN and SLACK_CHANNELS');
		}

		// Initializes your app with your bot token and signing secret
		slackApp = new App({
			token: botToken,
			signingSecret: signingSecret,
			socketMode: true, // enable to use socket mode
			appToken: appToken,
		});

		this.channels = new Set(channels.split(',').map((s) => s.trim()));

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
		logger.info(event);
		logger.info(`channel_type: ${event.channel_type}`);
		// logger.info(await (say['message']))
		const _say: SayFn = say;

		// if (event.channel_type === 'im')
		if (event.subtype === 'message_deleted') return;
		if (event.subtype === 'channel_join') return;

		// Check if the message is in the desired channel
		if (!this.channels.has(event.channel)) {
			logger.info(`Channel ${event.channel} not configured`);
			return;
		}
		console.log(`Message received in channel: ${_event.text}`);

		const agentService = appContext().agentStateService;

		// Messages with the app under the Apps section has different properties than messages from a regular channel
		if (event.channel === 'D08HGB1HF61') {
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
					resumeAgentId: `Slack-${threadId}`,
					initialPrompt: text,
					llms: defaultLLMs(),
					functions: CHATBOT_FUNCTIONS,
					agentName: `Slack-${threadId}`,
					systemPrompt:
						'You are an AI support agent called TypedAI.  You are responding to support requests on the company Slack account. Respond in a helpful, concise manner. If you encounter an error responding to the request do not provide details of the error to the user, only respond with "Sorry, I\'m having difficulties providing a response to your request"',
					metadata: { channel: event.channel },
					completedHandler: this,
					humanInLoop: {
						budget: 0.5,
						count: 5,
					},
				});
				await agentExec.execution;
				const agent: AgentContext = await appContext().agentStateService.load(agentExec.agentId);
				if (agent.state !== 'completed' && agent.state !== 'feedback') {
					logger.error(`Agent did not complete. State was ${agent.state}`);
					return;
				}
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
			// Getting a null agent when a conversation is started in the TG AI channel
			if (isExecuting(agent)) {
				// TODO make this transactional, and implement
				agent.pendingMessages.push();
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
