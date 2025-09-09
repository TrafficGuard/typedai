import { func, funcClass } from '#functionSchema/functionDecorators';
import { GitLab } from '#functions/scm/gitlab';

@funcClass(__filename)
export class BuildFailureAgent {
	@func()
	async analyseGitLabBuildFailure(buildUrl: string): Promise<void> {
		const gitlab: GitLab = new GitLab();

		// https://gitlab.example.com/group/subgroup/projectName/-/jobs/12345
		const parts = buildUrl.split('/');
		const projectPath = parts.slice(3, parts.indexOf('-')).join('/');
		const jobNumber = parts.at(-1)!;
		const logs = await gitlab.getJobLogs(projectPath, jobNumber);

		// If previous pipelines on the merge request/branch have failed then we need to look at the first failing pipeline diff
		const diff = await gitlab.getJobCommitDiff(projectPath, jobNumber);
	}
}
