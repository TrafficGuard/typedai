import { agentContext } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { getCurrentCallStack } from '#o11y/trace';
import type { AgentContext } from '#shared/agent/agent.model';
import type { LlmRequest } from '#shared/llmCall/llmCall.model';

export type CreateLlmRequest = Omit<LlmRequest, 'id' | 'requestTime'>;

export function callStack(agent?: AgentContext): string {
	agent ??= agentContext();

	const base = (() => {
		const asyncStack = getCurrentCallStack();
		if (asyncStack.length) return asyncStack;
		return agent?.callStack ?? [];
	})();

	if (!base.length) return '';

	const stack = [...base];

	if (stack.length > 1) {
		stack.shift();
		const idx = stack.indexOf('CodeGen Agent');
		if (idx !== -1) stack.splice(0, idx + 1);
	}

	let i = stack.length - 1;
	while (i > 0 && stack[i] === stack[i - 1]) i--;

	const formatted = stack.slice(0, i + 1).join(' > ');
	if (formatted) logger.info(formatted);
	return formatted;
}
