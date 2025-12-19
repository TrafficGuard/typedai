/**
 * Debater factory and exports
 *
 * @module agentic-debate/debaters
 */

import type { LLM } from '#shared/llm/llm.model';
import type { DebaterConfig, DebaterType, IDebater } from '../toolEnabledDebate';
import { ClaudeAgentDebater, type ClaudeAgentDebaterConfig, createClaudeAgentDebater, isClaudeAgentSdkAvailable } from './claudeAgentDebater';
import { LlmDebater, type LlmDebaterConfig, createLlmDebater } from './llmDebater';

// Re-export types and factories
export { LlmDebater, createLlmDebater, type LlmDebaterConfig } from './llmDebater';
export { ClaudeAgentDebater, createClaudeAgentDebater, isClaudeAgentSdkAvailable, type ClaudeAgentDebaterConfig } from './claudeAgentDebater';

/**
 * Create a debater from configuration
 */
export function createDebater(config: DebaterConfig): IDebater {
	switch (config.type) {
		case 'llm':
			if (!config.llm) {
				throw new Error('LLM debater requires an llm instance');
			}
			return createLlmDebater({
				id: config.id,
				name: config.name,
				llm: config.llm,
				persona: config.persona,
			});

		case 'claude-agent-sdk':
			return createClaudeAgentDebater({
				id: config.id,
				name: config.name,
				persona: config.persona,
			});

		default:
			throw new Error(`Unknown debater type: ${config.type}`);
	}
}

/**
 * Create multiple debaters from configurations
 */
export function createDebaters(configs: DebaterConfig[]): IDebater[] {
	return configs.map(createDebater);
}

/**
 * Quick factory for creating LLM debaters from LLM instances
 */
export function createLlmDebaters(llms: Array<{ id: string; name: string; llm: LLM }>): IDebater[] {
	return llms.map((config) =>
		createLlmDebater({
			id: config.id,
			name: config.name,
			llm: config.llm,
		}),
	);
}

/**
 * Get available debater types
 */
export async function getAvailableDebaterTypes(): Promise<DebaterType[]> {
	const types: DebaterType[] = ['llm'];

	if (await isClaudeAgentSdkAvailable()) {
		types.push('claude-agent-sdk');
	}

	return types;
}
