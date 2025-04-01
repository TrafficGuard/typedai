import { functionRegistry } from 'src/functionRegistry';
import { agentContext } from '#agent/agentContextLocalStorage';
import { GitProject } from './gitProject';

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
