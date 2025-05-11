import { startWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { logger } from '#o11y/logger';
import type { VibeSession } from '#shared/model/vibe.model';
import type { VibeRepository } from '#vibe/vibeRepository';

export async function runVibeWorkflowAgent(vibe: VibeSession, subtype: string, vibeRepo: VibeRepository, workflow: () => any): Promise<any> {
	// Prepare agent config, ensuring vibeSessionId is included
	const execution = await startWorkflowAgent(
		{
			agentName: `vibe-${vibe.id}-${subtype}`,
			functions: [], // TODO: Add necessary functions (e.g., SCM, FileSystem)
			initialPrompt: vibe.instructions, // Or specific prompt for the step
			vibeSessionId: vibe.id,
			subtype,
			// Assuming user is fetched earlier or passed in vibe object if needed
			// user: vibe.user,
			// Assuming fileSystemPath is derived correctly for the session
			// fileSystemPath: join(process.cwd(), 'vibe-workspaces', vibe.userId, vibe.id),
		},
		workflow,
	);

	// Update VibeSession state immediately after starting the agent
	const agentId = execution.agentId;
	await vibeRepo.updateVibeSession(vibe.userId, vibe.id, {
		agentHistory: [...(vibe.agentHistory || []), agentId], // Append to history
		lastAgentActivity: Date.now(),
	});
	logger.info({ vibeId: vibe.id, agentId, subtype }, 'VibeSession updated with current agent and history.');

	await execution.execution;
}
