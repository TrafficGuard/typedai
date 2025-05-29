import readline from 'readline';
import { logger } from '#o11y/logger';
/**
 * Adding a human in the loop, so it doesn't consume all of your budget
 */
import { startSpan, withSpan } from '#o11y/trace';
import type { AgentContext } from '#shared/agent/agent.model';
import { Slack } from '#slack/slack';
import { sleep } from '#utils/async-utils';
import { beep } from '#utils/beep';

export async function waitForConsoleInput(humanInLoopReason: string) {
	await withSpan('consoleHumanInLoop', async () => {
		// The span is created by withSpan, so the inner startSpan call was redundant.

		// await appContext().agentContextService.updateState(agentContextStorage.getStore(), 'humanInLoop_agent');

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		const question = (promptText: string): Promise<string> =>
			new Promise((resolve) => {
				rl.question(promptText, (answer) => resolve(answer));
			});

		let beepIntervalId: NodeJS.Timeout | undefined;

		// Beep every second until the user presses enter
		try {
			await beep();
			beepIntervalId = setInterval(async () => {
				try {
					await beep();
				} catch (error) {}
			}, 1000);

			logger.flush();

			await question(`Human-in-the-loop check: ${humanInLoopReason} \nPress enter to continue...`);
		} finally {
			if (beepIntervalId) clearInterval(beepIntervalId);
			rl.close();
		}
	});
}

export async function notifySupervisor(agent: AgentContext, message: string) {
	const slackConfig = agent.user.functionConfig[Slack.name];
	// TODO check for env vars
	if (slackConfig?.webhookUrl || slackConfig?.token) {
		try {
			await new Slack().sendMessage(message);
		} catch (e) {
			logger.error(e, 'Failed to send supervisor notification message');
		}
	}
}

export async function humanInTheLoop(reason: string) {
	await waitForConsoleInput(reason);
}
