import readline from 'readline';
import { logger } from '#o11y/logger';
import { withSpan } from '#o11y/trace';
import type { AgentContext } from '#shared/agent/agent.model';
import { Slack } from '#slack/slack';
import { beep } from '#utils/beep';
import { agentHumanInLoop } from './autonomousAgentRunner';

export async function waitForConsoleInput(agent: AgentContext, humanInLoopReason: string): Promise<void> {
	await withSpan('consoleHumanInLoop', async () => {
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

			console.log(`Agent: ${agent.name}`);
			await question(`Human-in-the-loop check: ${humanInLoopReason} \nPress enter to continue...`);
		} finally {
			if (beepIntervalId) clearInterval(beepIntervalId);
			rl.close();
		}
	});
}

export async function notifyAgentUser(agent: AgentContext, message: string): Promise<boolean> {
	const slackConfig = agent.user.functionConfig[Slack.name];
	// TODO check for env vars
	// If its an agent (eg. gitlab/github webhook agent) then will need to notify suitable people
	if (slackConfig?.webhookUrl || slackConfig?.token) {
		try {
			await new Slack().sendMessage(message);
			return true;
		} catch (e) {
			logger.error(e, 'Failed to send Slack notification message');
		}
	}
	return false;
}

/**
 * Pauses the live execution of the agent and waits for the user to resume it
 * @param agent
 * @param reason The reason for the human-in-the-loop check
 */
export async function humanInTheLoop(agent: AgentContext, reason: string): Promise<void> {
	if (process.env.DEPLOYMENT === 'server') {
		let resolveResumption: () => void;
		const resumptionPromise = new Promise<void>((resolve) => {
			resolveResumption = resolve;
		});

		const resume = resolveResumption!;

		agentHumanInLoop[agent.agentId] = {
			reason,
			resume: () => {
				resume();
				delete agentHumanInLoop[agent.agentId];
			},
		};

		// Notify the user if possible
		if (!(await notifyAgentUser(agent, reason))) logger.warn(`Human-in-the-loop check required for agent ${agent.agentId}. Reason: ${reason}`);

		await resumptionPromise;
	} else {
		// Local CLI usage waits for user input
		await waitForConsoleInput(agent, reason);
	}
}
