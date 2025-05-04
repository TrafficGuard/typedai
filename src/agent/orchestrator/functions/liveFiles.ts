import { agentContext } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';

export const LIVE_FILES_ADD = 'LiveFiles_addFiles';

export const LIVE_FILES_REMOVE = 'LiveFiles_removeFiles';

/**
 * Functions for the agent to add/remove files which always displays the current file contents in the agent control prompt
 */
@funcClass(__filename)
export class LiveFiles {
	/**
	 * Add files which will always have their current contents displayed in the <live-files> section (increasing LLM token costs)
	 * @param {string[]} files the files to always include the current contents of in the prompt
	 */
	@func()
	async addFiles(files: string[]): Promise<void> {
		const agent = agentContext();
		agent.liveFiles = Array.from(new Set([...agent.liveFiles, ...files]));
	}

	/**
	 * Remove files from the <live-files> section which are no longer required to reduce LLM token costs.
	 * @param {string[]} files The files to remove
	 */
	@func()
	async removeFiles(files: string[]): Promise<void> {
		const agent = agentContext();
		const liveFiles = new Set(agent.liveFiles);
		for (const f of files) {
			liveFiles.delete(f);
		}
		agent.liveFiles = Array.from(liveFiles);
	}
}
