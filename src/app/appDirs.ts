import { join } from 'node:path';

/** The default system dir folder */
export const typedaiDirName = '.typedai';

/** The name of the environment variable used to set the FilesystemService initial working directory path. */
export const TYPEDAI_FS = 'TYPEDAI_FS';

/**
 * @return the directory path where TypedAI stores persistent data (agent specific data etc)
 */
export function systemDir(): string {
	// When deploying TypedAI on a VM with a non-boot persistent disk for storage, or mounting
	// a Cloud Storage bucket for persistent storage, then set TYPEDAI_SYS_DIR
	return process.env.TYPEDAI_SYS_DIR || `${process.cwd()}/${typedaiDirName}`;
}

/**
 * @param agentId The ID of the agent, or if not provided is looked up from the current agent context
 * @return the directory path where data for an agent can be written to
 */
export function agentStorageDir(agentId?: string): string {
	if (agentId) return join(systemDir(), 'agents', agentId);
	// Need to lazy load for startup dependencies
	const { agentContext } = require('#agent/agentContextLocalStorage');
	const agent = agentContext();
	if (!agent || !agent.agentId) throw new Error('Agent context not available.');
	return join(systemDir(), 'agents', agent.agentId);
}
