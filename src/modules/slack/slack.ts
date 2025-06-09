import axios, { type AxiosResponse } from 'axios';
import { completedNotificationMessage } from '#agent/autonomous/agentCompletion';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import type { AgentCompleted, AgentContext } from '#shared/agent/agent.model';
import type { GetToolType, ToolType } from '#shared/agent/functions';
import { functionConfig } from '#user/userContext';

export interface SlackConfig {
	token: string;
	userId: string;
	webhookUrl: string;
}

@funcClass(__filename)
export class Slack implements GetToolType, AgentCompleted {
	getToolType(): ToolType {
		return 'notification';
	}

	async notifyCompleted(agentContext: AgentContext): Promise<void> {
		const message = completedNotificationMessage(agentContext);
		await this.sendMessage(message);
	}

	agentCompletedHandlerId(): string {
		return 'slack-webhook';
	}

	/**
	 * Sends a message to the supervisor
	 * @param message the message text
	 */
	@func()
	async sendMessage(message: string): Promise<void> {
		const config = functionConfig(Slack) as SlackConfig;
		const webhookUrl = config.webhookUrl;
		const token = config.token;
		const userId = config.userId;

		if (webhookUrl) {
			try {
				const response = await axios.post(webhookUrl, { text: message });
				if (response.status === 200) {
					logger.info(response.data, 'Message sent');
				} else {
					logger.error(response.data, `Error sending slack message to webhook. Status ${response.status}`);
				}
			} catch (error) {
				logger.error(error, 'Error sending Slack message to webhook');
				throw error;
			}
			return;
		}

		try {
			const response: AxiosResponse = await axios.post(
				'https://slack.com/api/chat.postMessage',
				{
					channel: userId,
					text: message,
				},
				{
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
				},
			);

			if (response.status === 200 && response.data.ok) {
				logger.info(response.data, `Message sent to ${userId}`);
			} else {
				logger.error(`Error sending slack message. Status ${response.status}`);
				logger.error(response.data, 'Error sending slack message:');
			}
		} catch (error) {
			logger.error(error, 'Error sending Slack message:');
			throw error;
		}
	}
}
