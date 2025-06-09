import { agentContext } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/agent/agent.model';
import type { LlmRequest } from '#shared/llmCall/llmCall.model';

export type CreateLlmRequest = Omit<LlmRequest, 'id' | 'requestTime'>;

export function callStack(agent?: AgentContext): string {
	agent ??= agentContext();
	if (!agent) return '';
	let arr: string[] = agent.callStack;
	if (!arr || arr.length === 0) return '';
	if (arr.length === 1) return arr[0];

	// Remove the common spans
	arr.shift();
	const index = arr.indexOf('CodeGen Agent');
	if (index !== -1) arr = arr.slice(index + 1, arr.length);

	// Remove duplicates from when we call multiple in parallel, eg in findFilesToEdit
	let i = arr.length - 1;
	while (i > 0 && arr[i] === arr[i - 1]) {
		i--;
	}
	logger.info(arr.slice(0, i + 1).join(' > '));
	return arr.slice(0, i + 1).join(' > ');
}
