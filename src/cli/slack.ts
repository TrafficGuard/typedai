import { initApplicationContext } from '#app/applicationContext';
import { sleep } from '#utils/async-utils';
import { slackConfig } from '../modules/slack/slackConfig';

async function main() {
	await initApplicationContext();
	const { SlackChatBotService } = await import('../modules/slack/slackModule.cjs');
	const config = slackConfig();
	config.autoStart = true;
	config.socketMode = true;
	const chatbot = new SlackChatBotService();
	await chatbot.initSlack();
	await sleep(60000);
}

main().then(() => console.log('done'), console.error);
