import { AgentContext } from '#agent/agentContextTypes';
import { humanInTheLoop } from '#agent/humanInTheLoop';
import { logger } from '#o11y/logger';
import { agentContext } from './agentContextLocalStorage';

export type HitlCounters = {
	iteration: number;
	costAccumulated: number;
	lastCost: number;
};

export async function checkHumanInTheLoop(
	counters: HitlCounters,
	agent: AgentContext,
	agentStateService: { save: (agent: AgentContext) => Promise<void> },
): Promise<HitlCounters> {
	const { hilCount, hilBudget } = agent;

	// Increment iteration counter and check if we've reached the HIL threshold
	counters.iteration++;
	if (hilCount && counters.iteration >= hilCount) {
		agent.state = 'hil';
		await agentStateService.save(agent);
		await humanInTheLoop(`Agent control loop has performed ${hilCount} iterations`);
		agent.state = 'agent';
		await agentStateService.save(agent);
		counters.iteration = 0;
	}

	// Update cost tracking
	const currentCost = agentContext().cost;
	const newCosts = currentCost - counters.lastCost;
	counters.lastCost = currentCost;
	counters.costAccumulated += newCosts;
	logger.debug(`Spent $${counters.costAccumulated.toFixed(2)} since last input. Total cost $${currentCost.toFixed(2)}`);

	if (hilBudget && counters.costAccumulated > hilBudget) {
		await humanInTheLoop(`Agent cost has increased by USD\$${counters.costAccumulated.toFixed(2)}`);
		counters.costAccumulated = 0;
	}

	return counters;
}
