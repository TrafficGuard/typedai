import { join } from 'path';
import { agentContext } from '#agent/agentContextLocalStorage';

export const typedaiDirName = '.typedai';

export const TYPEDAI_FS = 'TYPEDAI_FS';

/**
 * @return the directory path where TypedAI stores its data
 */
export function systemDir() {
	// When deploying TypedAI on a VM with a non-boot persistent disk for storage, then set TYPEDAI_SYS_DIR
	return `${process.env.TYPEDAI_SYS_DIR || process.cwd()}/${typedaiDirName}`;
}

/**
 * @return the directory path where an agent can freely read/write to
 */
export function agentDir(): string {
	return join(systemDir(), 'agents', agentContext().agentId);
}
