export async function analyseAutonomousIteration(agentId: string, iteration: number): Promise<void> {
	const prompt = `Analyse the autonomous iteration ${iteration} for agent ${agentId}

// TODO Include the source for codegenAutonomousAgent.ts
// TODO we want the agent planning LLM call (initial or retry if exists) for this iterations

What was the issue with the iteration? What could be improved in the
- system prompt
- function definition documention
- other
To improve the outcome of this iteration?
`;
}
