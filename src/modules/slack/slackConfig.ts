import { getSecretEnvVar } from '#config/secretConfig';
import { logger } from '#o11y/logger';

export interface SlackConfig {
	socketMode: boolean;
	autoStart: boolean;
	botToken: string;
	signingSecret: string;
	appToken: string;
	channels: string[];
}

let config: SlackConfig | undefined;

export function slackConfig(): SlackConfig {
	config ??= createSlackConfig();
	return config;
}

function createSlackConfig(): SlackConfig {
	const config: SlackConfig = {
		socketMode: process.env.SLACK_SOCKET_MODE?.trim().toLowerCase() === 'true',
		autoStart: process.env.SLACK_AUTO_START?.trim().toLowerCase() === 'true',
		botToken: getSecretEnvVar('SLACK_BOT_TOKEN', ''),
		signingSecret: getSecretEnvVar('SLACK_SIGNING_SECRET', ''),
		appToken: getSecretEnvVar('SLACK_APP_TOKEN', ''),
		channels: process.env.SLACK_CHANNELS?.split(',')?.map((s) => s.trim()) || [],
	};
	const maskedConfig: SlackConfig = {
		socketMode: config.socketMode,
		autoStart: config.autoStart,
		channels: config.channels,
		// secrets
		botToken: config.botToken?.substring(0, 5),
		signingSecret: config.signingSecret?.substring(0, 5),
		appToken: config.appToken?.substring(0, 5),
	};
	logger.info({ config: maskedConfig }, 'Slack config');
	return config;
}
