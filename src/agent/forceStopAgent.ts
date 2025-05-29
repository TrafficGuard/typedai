import { agentContext, agentContextStorage } from '#agent/agentContextLocalStorage';
import { appContext } from '#app/applicationContext';
import { isExecuting } from '#shared/agent/agent.model';
import { currentUser } from '#user/userContext';

const agentsToStop = new Set<string>();

export class ForceStopError extends Error {
	constructor() {
		super('The user has force stopped the agent');
	}
}

export function forceStopErrorCheck(e: any): void {
	if (e instanceof ForceStopError) throw e;
}

/**
 * Terminates the execution of an agent as soon as possible.
 * @param agentId
 */
export async function forceStopAgent(agentId: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (!agent) throw new Error(`No agent with id ${agentId}`);
	if (!isExecuting(agent)) throw new Error(`Agent ${agentId} is not in an executing state`);
	if (agent.user.id !== currentUser().id) throw new Error('Cannot stop an agent owned by another user');

	agentsToStop.add(agent.agentId);

	// Reload the agent every 5 seconds for up to a minute and see if it's not in an executing state
	return new Promise((resolve, reject) => {
		const startTime = Date.now();
		const interval = setInterval(async () => {
			const updatedAgent = await appContext().agentStateService.load(agentId);
			// Agent should be in an error state if the checkForceStopped() function has been called in its execution
			if (!isExecuting(updatedAgent)) {
				clearInterval(interval);
				agentsToStop.delete(agent.agentId);
				resolve();
			} else if (Date.now() - startTime >= 60000) {
				// 1 minute timeout
				clearInterval(interval);
				agentsToStop.delete(agent.agentId);
				reject(new Error(`Agent ${agentId} did not stop executing within 1 minute`));
			}
		}, 5000);
	});
}

/**
 * Checks if the current agent should be force stopped
 */
export function checkForceStopped(): void {
	const agent = agentContext();
	if (!agent) return;
	const agentId = typeof agent === 'string' ? agent : agent.agentId;

	if (agentsToStop.has(agentId)) {
		agentsToStop.delete(agentId);
		throw new Error(`Agent ${agentId} has been force stopped by user ${currentUser().id}`);
	}
}
