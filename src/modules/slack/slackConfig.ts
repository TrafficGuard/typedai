import { existsSync } from 'node:fs';

export interface SlackConfig {
	hasSupportDocs: boolean;
	supportDocsProject: string;
	supportDocsLocalPath: string;
	socketMode: boolean;
	autoStart: boolean;
}

let config: SlackConfig | undefined;

export function slackConfig(): SlackConfig {
	config ??= createSlackConfig();
	return config;
}

function createSlackConfig(): SlackConfig {
	const supportDocsLocalPath = process.env.SLACK_SUPPORT_DOCS_LOCAL_PATH?.trim() || '';
	const hasLocalDocs = Boolean(supportDocsLocalPath && existsSync(supportDocsLocalPath));
	return {
		hasSupportDocs: hasLocalDocs || Boolean(process.env.SLACK_SUPPORT_DOCS_PROJECT?.trim()),
		supportDocsLocalPath: supportDocsLocalPath,
		supportDocsProject: process.env.SLACK_SUPPORT_DOCS_PROJECT ?? '',
		socketMode: Boolean(process.env.SLACK_SOCKET_MODE?.trim()),
		autoStart: Boolean(process.env.SLACK_AUTO_START?.trim()),
	};
}
