import { sleep } from '#utils/async-utils';
import { initApplicationContext } from '../applicationContext';

async function main() {
	await initApplicationContext();
	const { SlackChatBotService } = await import('../modules/slack/slackModule.cjs');
	const chatbot = new SlackChatBotService();
	await chatbot.initSlack();
	await sleep(60000);
}

main().then(() => console.log('done'), console.error);
