import { getFileSystem } from '#agent/agentContextLocalStorage';
import { cacheRetry } from '#cache/cacheRetry';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { type MergeRequest, getSourceControlManagementTool } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { GitProject } from '#shared/scm/git.model';
import { createBranchName } from '#swe/createBranchName';
import { generatePullRequestTitleDescription } from '#swe/pullRequestTitleDescription';
import { selectProject } from '#swe/selectProject';
import { summariseRequirements } from '#swe/summariseRequirements';
import { CodeEditingAgent } from './codeEditingAgent';
import { type ProjectInfo, getProjectInfos } from './projectDetection';

/**
 * Workflow for completing requirements. This will look up the appropriate project in source control, clone, make the changes and create a pull/merge request.
 * Assumes the SourceControlManagement tool is set on the workflow context
 */
@funcClass(__filename)
export class SoftwareDeveloperAgent {
	/**
	 * Runs the software developer agent to complete the user request/requirements. This will find the appropriate Git project/repository, clone it, make the changes, compile and test if applicable, commit and create a pull/merge request to review.
	 * @param requirements the requirements to implement. Provide ALL the details that might be required by this agent to complete the requirements task. Do not refer to details in memory etc, or that would require functions to look up. You must provide the actual details.
	 * @param scmFullProjectPath (Optional) The full path to the GitHub/GitLab etc. repository, if definitely known. (e.g.  org/repo or group1/group2/project). Otherwise, leave blank, and it will be determined by searching through all the available projects.
	 * @returns the Merge/Pull request URL if one was created
	 */
	@func()
	async runSoftwareDeveloperWorkflow(requirements: string, scmFullProjectPath?: string): Promise<MergeRequest> {
		const fileSystem = getFileSystem();
		const scm = await getSourceControlManagementTool();

		const requirementsSummary = await this.summariseRequirements(requirements);

		// Select the Git project. If scmFullProjectPath is provided and matches a project, then skip the LLM search
		let gitProject: GitProject | undefined;
		let selectProjectRequirements = requirementsSummary;
		if (scmFullProjectPath) {
			gitProject = (await scm.getProjects()).find((project) => project.fullPath.toLowerCase() === scmFullProjectPath.toLowerCase());
			if (!gitProject) selectProjectRequirements += `\nRepo name hint: ${scmFullProjectPath}`;
		}
		if (!gitProject) gitProject = await this.selectProject(selectProjectRequirements);
		logger.info(`Git project ${JSON.stringify(gitProject)}`);

		const repoPath = await scm.cloneProject(gitProject.fullPath, gitProject.defaultBranch);
		fileSystem.setWorkingDirectory(repoPath);

		const projectInfo = await this.detectSingleProjectInfo();

		// Branch setup -----------------

		// TODO If we've already created the feature branch (how can we tell?) and doing more work on it, then don't need to switch to the base dev branch
		// If the default branch in Gitlab/GitHub isn't the branch we want to create feature branches from, then switch to it.
		let baseBranch = gitProject.defaultBranch;
		if (projectInfo.devBranch && projectInfo.devBranch !== baseBranch) {
			await fileSystem.getVcs().switchToBranch(projectInfo.devBranch);
			baseBranch = projectInfo.devBranch;
		}
		await fileSystem.getVcs().pull();

		const featureBranchName = await this.createBranchName(requirements);
		await fileSystem.getVcs().switchToBranch(featureBranchName);

		const initialHeadSha: string = await fileSystem.getVcs().getHeadSha();

		try {
			await new CodeEditingAgent().implementUserRequirements(requirementsSummary, { projectInfo });
		} catch (e) {
			logger.warn(e.message);
			// If no changes were made then throw an error
			const currentHeadSha: string = await fileSystem.getVcs().getHeadSha();
			if (initialHeadSha === currentHeadSha) {
				throw e;
			}
			// Otherwise swallow the exception so we can push the changes made so far for review
		}

		const { title, description } = await generatePullRequestTitleDescription(requirements, baseBranch);

		return await scm.createMergeRequest(gitProject.id, title, description, featureBranchName, baseBranch);
	}

	@cacheRetry({ scope: 'agent' })
	@span()
	async createBranchName(requirements: string, issueId?: string): Promise<string> {
		// We always want the agent to use the same branch name when its resumed/retrying, so we cache it in the agent scope
		return await createBranchName(requirements, issueId);
	}

	/**
	 * Summarises/re-writes the requirements in a clear, structured manner from the perspective of a software developer who needs is doing the implementation
	 * @param requirements the requirements to implement
	 */
	@cacheRetry()
	@span()
	async summariseRequirements(requirements: string): Promise<string> {
		return await summariseRequirements(requirements);
	}

	@cacheRetry({ scope: 'agent' })
	@span()
	async selectProject(requirements: string): Promise<GitProject> {
		return await selectProject(requirements);
	}

	// @cacheRetry()
	async detectProjectInfo(): Promise<ProjectInfo[] | null> {
		return await getProjectInfos();
	}

	/**
	 * A project configuration file may have references to sub-projects. Calling this method assumes
	 * there will be only one entry in the ${AI_INFO_FILENAME} file, and will throw an error if there is more
	 */
	async detectSingleProjectInfo(): Promise<ProjectInfo> {
		const projectInfos = await this.detectProjectInfo();
		if (!projectInfos || projectInfos.length !== 1) throw new Error('detected project info length != 1');
		const projectInfo = projectInfos[0];
		logger.info(projectInfo, `Detected project info ${Object.keys(projectInfo).join(', ')}`);
		return projectInfo;
	}
}
