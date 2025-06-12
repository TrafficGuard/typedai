import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AgentContextApi, Iteration, LlmCall } from '#shared/agent/agent.schema';

import { AgentIterationsComponent } from './AgentIterations.component';
import { AgentIterationsPo } from './AgentIterations.component.po';

// Mock Data
const mockLlmCall1: LlmCall = {
	llmCallId: 'llm001',
	traceId: 'trace001',
	type: 'CHAT',
	status: 'SUCCESS',
	startTime: new Date().toISOString(),
	endTime: new Date().toISOString(),
	llmId: 'test-llm',
	prompt: 'Test prompt 1',
	response: 'Test response 1',
	promptTokens: 10,
	responseTokens: 20,
	totalTokens: 30,
};

const mockLlmCall2: LlmCall = {
	llmCallId: 'llm002',
	traceId: 'trace002',
	type: 'CHAT',
	status: 'SUCCESS',
	startTime: new Date().toISOString(),
	endTime: new Date().toISOString(),
	llmId: 'test-llm',
	prompt: 'Test prompt 2',
	response: { complex: 'object', value: 42 },
	promptTokens: 15,
	responseTokens: 25,
	totalTokens: 40,
};

const mockIteration1: Iteration = {
	iterationId: 'iter001',
	startTime: new Date().toISOString(),
	status: 'COMPLETED',
	llmCallIds: [mockLlmCall1.llmCallId],
	messages: [],
};

const mockIteration2: Iteration = {
	iterationId: 'iter002',
	startTime: new Date().toISOString(),
	status: 'PROCESSING_FUNCTION_CALL',
	llmCallIds: [mockLlmCall2.llmCallId],
	messages: [],
	functionCall: { name: 'testFunc', arguments: '{ "arg": "val" }' },
};

const mockAgentDetailsEmpty: AgentContextApi = {
	agentId: 'agentTest1',
	status: 'COMPLETED',
	startTime: new Date().toISOString(),
	iterations: [],
	llmCalls: [],
};

const mockAgentDetailsWithIterations: AgentContextApi = {
	agentId: 'agentTest2',
	status: 'COMPLETED',
	startTime: new Date().toISOString(),
	iterations: [mockIteration1, mockIteration2],
	llmCalls: [mockLlmCall1, mockLlmCall2],
};

describe('AgentIterationsComponent', () => {
	let component: AgentIterationsComponent;
	let fixture: ComponentFixture<AgentIterationsComponent>;
	let po: AgentIterationsPo;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [AgentIterationsComponent, NoopAnimationsModule],
		}).compileComponents();

		fixture = TestBed.createComponent(AgentIterationsComponent);
		component = fixture.componentInstance;
		po = await AgentIterationsPo.create(fixture);
		// Initial detection, inputs will be set per test
		fixture.detectChanges();
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	describe('Functional tests', () => {
		it('should display a "no iterations" message when agentDetails has no iterations', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsEmpty);
			await po.detectAndWait();

			expect(await po.isNoIterationsMessageDisplayed()).toBe(true);
			const accordion = await po.getAccordionHarness();
			expect(accordion).toBeNull();
		});

		it('should display iterations when agentDetails with iterations is provided', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithIterations);
			await po.detectAndWait();

			expect(await po.isNoIterationsMessageDisplayed()).toBe(false);
			const accordion = await po.getAccordionHarness();
			expect(accordion).toBeTruthy();
			if (accordion) {
				const panels = await po.getAllExpansionPanelHarnesses(accordion);
				// Iterations are reversed in the component
				expect(panels.length).toBe(mockAgentDetailsWithIterations.iterations.length);
			}
		});

		it('should display iteration details in panel title (reversed order)', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithIterations);
			await po.detectAndWait();

			const panels = await po.getAllExpansionPanelHarnesses();
			expect(panels.length).toBe(2);

			// Iterations are reversed, so panel 0 is mockIteration2, panel 1 is mockIteration1
			const panel0Title = await panels[0]?.getTitle();
			const panel1Title = await panels[1]?.getTitle();

			// Example: Title might contain iteration ID and status. Adjust if template is different.
			// This is a loose check; exact title format depends on the template.
			expect(panel0Title).toContain(mockIteration2.iterationId);
			expect(panel0Title).toContain(mockIteration2.status);

			expect(panel1Title).toContain(mockIteration1.iterationId);
			expect(panel1Title).toContain(mockIteration1.status);
		});

		it('should expand and collapse iteration panels', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithIterations);
			await po.detectAndWait();

			const panels = await po.getAllExpansionPanelHarnesses();
			const firstPanel = panels[0]; // Corresponds to reversed mockIteration2

			if (firstPanel) {
				expect(await po.isPanelExpanded(firstPanel)).toBe(false); // Assuming panels start collapsed

				await po.expandPanel(firstPanel);
				await po.detectAndWait(); // Allow UI to update
				expect(await po.isPanelExpanded(firstPanel)).toBe(true);

				await po.collapsePanel(firstPanel);
				await po.detectAndWait(); // Allow UI to update
				expect(await po.isPanelExpanded(firstPanel)).toBe(false);
			} else {
				fail('First panel not found');
			}
		});

		it('should display LLM call details when panel is expanded', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithIterations);
			await po.detectAndWait();

			const panels = await po.getAllExpansionPanelHarnesses();
			// mockIteration2 is the first panel due to reversal, it has llmCall002
			const panelForIter2 = panels[0];

			if (panelForIter2) {
				await po.expandPanel(panelForIter2);
				await po.detectAndWait();

				const llmCallContent = await po.getLlmCallContentInSection(panelForIter2, mockLlmCall2.llmCallId);
				expect(llmCallContent).toBeTruthy();
				// The content is JSON stringified
				expect(llmCallContent).toContain(JSON.stringify(mockLlmCall2.prompt, null, 2).slice(1, -1)); // Check for prompt content
				expect(llmCallContent).toContain(JSON.stringify(mockLlmCall2.response, null, 2).slice(1, -1)); // Check for response content
			} else {
				fail('Panel for Iteration2 not found');
			}
		});
	});
});
