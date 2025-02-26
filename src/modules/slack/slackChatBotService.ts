import { App, SayFn } from '@slack/bolt';
import { StringIndexed } from '@slack/bolt/dist/types/helpers';
import { getLastFunctionCallArg } from '#agent/agentCompletion';
import { AgentCompleted, AgentContext, isExecuting } from '#agent/agentContextTypes';
import { REQUEST_FEEDBACK_PARAM_NAME } from '#agent/agentFeedback';
import { AGENT_COMPLETED_PARAM_NAME } from '#agent/agentFunctions';
import { resumeCompleted, startAgent } from '#agent/agentRunner';
import { GoogleCloud } from '#functions/cloud/google/google-cloud';
import { GitLab } from '#functions/scm/gitlab';
import { LlmTools } from '#functions/util';
import { Perplexity } from '#functions/web/perplexity';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { sleep } from '#utils/async-utils';
import { appContext } from '../../applicationContext';
import { ChatBotService } from '../../chatBot/chatBotService';

let slackApp: App<StringIndexed> | undefined;

const CHATBOT_FUNCTIONS: Array<new () => any> = [GitLab, GoogleCloud, Perplexity, LlmTools];

/**
 * Slack implementation of ChatBotService
 * Only one Slack workspace can be configured in the application as the Slack App is shared between all instances of this class.
 */
export class SlackChatBotService implements ChatBotService, AgentCompleted {
	threadId(agent: AgentContext): string {
		return agent.agentId.replace('Slack-', '');
	}

	agentCompletedHandlerId(): string {
		return 'console';
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

		if (!botToken || !signingSecret || !channels) {
			logger.error('Slack chatbot requires environment variables SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET and SLACK_CHANNELS');
		}

		// Initializes your app with your bot token and signing secret
		slackApp = new App({
			token: botToken,
			signingSecret: signingSecret,
			socketMode: true, // enable to use socket mode
			appToken: appToken,
		});

		const slackChannels = new Set(channels.split(',').map((s) => s.trim()));

		// Listen for messages in channels
		slackApp.event('message', async ({ event, say }) => {
			// biomejs formatter changes event['property'] to event.property which doesn't compile
			const _event: any = event;
			console.log('Event received for message');
			logger.info(event);
			logger.info('say');
			logger.info(say);
			// logger.info(await (say['message']))
			const _say: SayFn = say;
			// Check if the message is in the desired channel
			if (!slackChannels.has(event.channel)) {
				logger.info(`Channel ${event.channel} not configured`);
				return;
			}
			console.log(`Message received in channel: ${_event.text}`);

			const agentService = appContext().agentStateService;

			// If the message is not a reply in a thread, then we will start a new agent to handle the first message in the thread
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
					});
					await agentExec.execution;
					const agent: AgentContext = await appContext().agentStateService.load(agentExec.agentId);
					if (agent.state !== 'completed' && agent.state !== 'feedback') {
						logger.error(`Agent did not complete. State was ${agent.state}`);
						return;
					}

					const response = agent.functionCallHistory.at(-1).parameters[agent.state === 'completed' ? AGENT_COMPLETED_PARAM_NAME : REQUEST_FEEDBACK_PARAM_NAME];
					const sayResult = await say({
						text: response,
						thread_ts: threadId,
						channel: event.channel,
					});
					if (!sayResult.ok) {
						logger.error(sayResult.error, 'Error replying');
					}
				} catch (e) {
					logger.error(e, 'Error handling new Slack thread');
				}
			} else {
				// Otherwise this is a reply to a thread
				const agentId = `Slack-${_event.thread_ts}`;
				const agent = await agentService.load(agentId);
				if (isExecuting(agent)) {
					// TODO make this transactional
					agent.pendingMessages.push();
					await agentService.save(agent);
					return;
				}
				await resumeCompleted(agentId, agent.executionId, _event.text);
			}
			// Respond or process the message as needed
		});

		slackApp.event('app_mention', async ({ event, say }) => {
			console.log('app_mention received');
			// TODO if not in a channel we are subscribed to, then get the thread messages and reply to it
		});

		await slackApp.start();

		logger.info('Registered event listener');

		await sleep(300000);
	}
}
