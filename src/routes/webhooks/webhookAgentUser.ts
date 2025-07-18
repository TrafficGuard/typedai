import { appContext } from '#app/applicationContext';
import { logger } from '#o11y/logger';
import { envVar } from '#utils/env-var';

/**
 * @returns the user to run the agent as
 */
export async function getAgentUser() {
	const userService = appContext().userService;
	let email = (process.env.TYPEDAI_AGENT_EMAIL ?? '').trim();
	if (!email && process.env.AUTH === 'single_user') email = envVar('SINGLE_USER_EMAIL');

	let runAsUser = await userService.getUserByEmail(email);
	if (!runAsUser) {
		logger.info(`Creating TypedAI Agent account with email ${email}`);
		runAsUser = await userService.createUser({ name: 'TypedAI Agent', email, enabled: true });
	}
	return runAsUser;
}
