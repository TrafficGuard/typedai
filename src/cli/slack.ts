import { initApplicationContext } from '#app/applicationContext';
import { sleep } from '#utils/async-utils';
import { loadCliEnvironment } from './envLoader';

async function main() {
	loadCliEnvironment();
	await initApplicationContext();
	const { SlackChatBotService } = await import('../modules/slack/slackModule.cjs');
	const chatbot = new SlackChatBotService();
	await chatbot.initSlack();
	await sleep(60000);
}

main().then(() => console.log('done'), console.error);
