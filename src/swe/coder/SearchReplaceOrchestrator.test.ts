import { expect } from 'chai';
import * as sinon from 'sinon';
import { MockLLM } from '#llm/services/mock-llm';
import type { LLM, LlmMessage } from '#shared/llm/llm.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditApplier } from './editApplier';
import type { PromptBuilder } from './PromptBuilder';
import { CoderConfig, SearchReplaceOrchestrator } from './SearchReplaceOrchestrator';
import type { EditPreparer } from './services/EditPreparer';
import type { ReflectionGenerator } from './services/ReflectionGenerator';
import type { ResponseProcessor } from './services/ResponseProcessor';
import { EditSession } from './state/EditSession';

describe('SearchReplaceOrchestrator', () => {
	setupConditionalLoggerOutput();

	let orchestrator: SearchReplaceOrchestrator;
	let mockConfig: CoderConfig;
	let mockResponseProcessor: sinon.SinonStubbedInstance<ResponseProcessor>;
	let mockEditPreparer: sinon.SinonStubbedInstance<EditPreparer>;
	let mockReflectionGenerator: sinon.SinonStubbedInstance<ReflectionGenerator>;
	let mockPromptBuilder: sinon.SinonStubbedInstance<PromptBuilder>;
	let mockEditApplier: sinon.SinonStubbedInstance<EditApplier>;
	let session: EditSession;
	let llm: LLM;
	let messages: LlmMessage[];

	beforeEach(() => {
		mockConfig = { maxAttempts: 3 };
		// Use createStubInstance to create type-safe stubs of the dependency classes
		mockResponseProcessor = sinon.createStubInstance(ResponseProcessor);
		mockEditPreparer = sinon.createStubInstance(EditPreparer);
		mockReflectionGenerator = sinon.createStubInstance(ReflectionGenerator);
		mockPromptBuilder = sinon.createStubInstance(PromptBuilder);
		mockEditApplier = sinon.createStubInstance(EditApplier);

		orchestrator = new SearchReplaceOrchestrator(
			mockConfig,
			mockResponseProcessor,
			mockEditPreparer,
			mockReflectionGenerator,
			mockPromptBuilder,
			mockEditApplier,
		);

		session = new EditSession('/repo', 'test requirements');
		llm = new MockLLM();
		messages = [{ role: 'user', content: 'test' }];
	});

	afterEach(() => {
		sinon.restore();
	});

	describe('execute', () => {
		it('should be implemented in a future step', () => {
			// This test serves as a placeholder for the orchestration logic tests.
			expect(orchestrator).to.exist;
		});
	});
});
