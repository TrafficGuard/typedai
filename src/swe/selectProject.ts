import { llms } from '#agent/agentContextLocalStorage';
import { type SourceControlManagement, getSourceControlManagementTool } from '#functions/scm/sourceControlManagement';
import type { GitProject } from '#shared/scm/git.model';
import { buildPrompt } from '#swe/prompt';

export async function selectProject(requirements: string): Promise<GitProject> {
	const scm: SourceControlManagement = await getSourceControlManagementTool();
	const projects: GitProject[] = await scm.getProjects();
	const prompt: string = buildPrompt({
		information: `The following is a list of our projects in our git server:\n${JSON.stringify(projects)}`,
		requirements,
		action:
			'You task is to only select the project object for the relevant repository which needs to cloned so we can later edit it to complete task requirements. Output your answer in JSON format and only output JSON',
	});

	const result = await llms().hard.generateTextWithJson(prompt, { id: 'selectProject', thinking: 'high' });
	return result.object as GitProject;
}
