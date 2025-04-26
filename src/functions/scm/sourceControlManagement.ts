import { functionRegistry } from 'src/functionRegistry';
import { agentContext } from '#agent/agentContextLocalStorage';
import { execCommand } from '#utils/exec';
import type { GitProject } from './gitProject';

export interface MergeRequest {
	id: number;
	iid: number;
	url: string;
	title: string;
}

/**
 * Source Code Management system (GitHub, Gitlab, BitBucket etc)
 */
export interface SourceControlManagement {
	getProjects(): Promise<GitProject[]>;

	getProject(projectId: string | number): Promise<GitProject>;

	cloneProject(projectPathWithNamespace: string, branchOrCommit?: string): Promise<string>;

	createMergeRequest(projectId: string | number, title: string, description: string, sourceBranch: string, targetBranch: string): Promise<MergeRequest>;

	getJobLogs(projectPath: string, jobId: string): Promise<string>;

	/**
	 * Checks if the necessary configuration (e.g., API tokens, host URLs) is present.
	 * @returns {boolean} True if configured, false otherwise.
	 */
	isConfigured(): boolean;
}

function isScmObject(obj: Record<string, any>): boolean {
	return obj && typeof obj.getProjects === 'function' && typeof obj.cloneProject === 'function' && typeof obj.createMergeRequest === 'function';
}

/**
 * Gets the function class implementing SourceControlManagement.
 * It first searches the agents functions, then falls back to searching the function registry.
 */
export function getSourceControlManagementTool(): SourceControlManagement {
	const scm = agentContext().functions.getFunctionInstances().find(isScmObject) as SourceControlManagement;
	if (scm) return scm;

	const scms = functionRegistry()
		.map((ctor) => new ctor())
		.filter(isScmObject);
	if (scms.length === 0) throw new Error('No function classes found which implement SourceControlManagement');
	if (scms.length > 1) throw new Error('More than one function classes found implementing SourceControlManagement');
	return scms[0];
}

/**
 * Pushes the specified branch to the 'origin' remote and sets it up to track the remote branch.
 * Throws an error if the push fails.
 * @param sourceBranch The name of the branch to push.
 */
export async function pushBranchToOrigin(sourceBranch: string): Promise<void> {
	const cmd = `git push --set-upstream origin '${sourceBranch}'`;
	const { exitCode, stdout, stderr } = await execCommand(cmd);
	if (exitCode > 0) {
		// Combine stdout and stderr for a comprehensive error message
		const errorMessage = `Failed to push branch '${sourceBranch}' to origin.\nstdout: ${stdout}\nstderr: ${stderr}`;
		throw new Error(errorMessage);
	}
}
