import type { LLM, LlmMessage } from '#shared/llm/llm.model';
import type { PromptBuilder } from './PromptBuilder';
import type { EditApplier } from './editApplier';
import type { EditPreparer } from './services/EditPreparer';
import type { ReflectionGenerator } from './services/ReflectionGenerator';
import type { ResponseProcessor } from './services/ResponseProcessor';
import type { EditSession } from './state/EditSession';

export interface CoderConfig {
	maxAttempts: number;
}

export class SearchReplaceOrchestrator {
	constructor(
		private config: CoderConfig,
		private responseProcessor: ResponseProcessor,
		private editPreparer: EditPreparer,
		private reflectionGenerator: ReflectionGenerator,
		private promptBuilder: PromptBuilder,
		private editApplier: EditApplier,
	) {}

	async execute(session: EditSession, llm: LLM, messages: LlmMessage[]): Promise<void> {
		// The main orchestration logic will be moved here from SearchReplaceCoder.
	}
}
