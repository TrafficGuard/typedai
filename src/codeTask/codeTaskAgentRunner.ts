import { startWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { logger } from '#o11y/logger';
import type { CodeTask } from '#shared/codeTask/codeTask.model';
import type { CodeTaskRepository } from './codeTaskRepository';

export async function runCodeTaskWorkflowAgent(codeTask: CodeTask, subtype: string, codeTaskRepo: CodeTaskRepository, workflow: () => any): Promise<any> {
	// Prepare agent config, ensuring codeTaskId is included
	const execution = await startWorkflowAgent(
		{
			agentName: `code-task-${codeTask.id}-${subtype}`,
			functions: [], // TODO: Add necessary functions (e.g., SCM, FileSystem)
			initialPrompt: codeTask.instructions, // Or specific prompt for the step
			codeTaskId: codeTask.id,
			subtype,
			// Assuming user is fetched earlier or passed in codeTask object if needed
			// user: codeTask.user,
			// Assuming fileSystemPath is derived correctly for the codeTask
			// fileSystemPath: join(process.cwd(), 'codeTask-workspaces', codeTask.userId, codeTask.id),
		},
		workflow,
	);

	// Update CodeTask state immediately after starting the agent
	const agentId = execution.agentId;
	await codeTaskRepo.updateCodeTask(codeTask.userId, codeTask.id, {
		agentHistory: [...(codeTask.agentHistory || []), agentId], // Append to history
		lastAgentActivity: Date.now(),
	});
	logger.info({ codeTask: codeTask.id, agentId, subtype }, 'CodeTask updated with current agent and history.');

	await execution.execution;
}
