import { agentContext } from '#agent/agentContext';
import type { GetToolType } from '#shared/agent/functions';

import type { GitProject } from '#shared/scm/git.model';

export interface MergeRequest {
	id: number;
	iid: number;
	url: string;
	title: string;
}

/**
 * Source Code Management system (GitHub, Gitlab, BitBucket etc)
 */
export interface SourceControlManagement extends GetToolType {
	getProjects(): Promise<GitProject[]>;

	getProject(projectId: string | number): Promise<GitProject>;

	/**
	 * @param projectPathWithNamespace
	 * @param branchOrCommit
	 * @param targetDirectory dir to clone to
	 * @returns the directory path where the project was successfully cloned.
	 */
	cloneProject(projectPathWithNamespace: string, branchOrCommit?: string, targetDirectory?: string): Promise<string>;

	createMergeRequest(projectId: string | number, title: string, description: string, sourceBranch: string, targetBranch: string): Promise<MergeRequest>;

	getJobLogs(projectPath: string, jobId: string): Promise<string>;

	/**
	 * Gets the list of branches for a given project.
	 * @param projectId The identifier for the project (e.g., 'owner/repo' for GitHub, 'group/project' or numeric ID for GitLab).
	 * @returns A promise that resolves to an array of branch names.
	 */
	getBranches(projectId: string | number): Promise<string[]>;

	/**
	 * Checks if the necessary configuration (e.g., API tokens, host URLs) is present.
	 * @returns {boolean} True if configured, false otherwise.
	 */
	isConfigured(): boolean;

	/**
	 * Returns the type of the SCM provider (e.g., 'github', 'gitlab').
	 */
	getScmType(): string;
}

function isScmObject(obj: Record<string, any>): boolean {
	return obj && typeof obj.getScmType === 'function';
}

/**
 * Gets the function class implementing SourceControlManagement from the AgentContext
 * It first searches the agents functions, then falls back to searching the function registry for a single match.
 */
export async function getSourceControlManagementTool(): Promise<SourceControlManagement> {
	const scm = agentContext()!.functions.getFunctionInstances().find(isScmObject) as SourceControlManagement;
	if (scm) return scm;
	// dynamic import is required to avoid module loading dependency issues
	const functionRegistry = (await import('../../functionRegistryModule.cjs')).functionRegistry as () => Array<new () => any>;
	const scms = functionRegistry()
		.map((ctor) => new ctor())
		.filter(isScmObject);
	if (scms.length === 0) throw new Error('No function classes found which implement SourceControlManagement');
	if (scms.length > 1) throw new Error('More than one function classes found implementing SourceControlManagement');
	return scms[0];
}
