import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AgentFunctionCallsComponent } from './agent-function-calls.component';
import { AgentFunctionCallsPo } from './agent-function-calls.component.po';
// Assuming AgentContextApi and FunctionCall are complex, define simplified versions for test mocks
// Ideally, import from '#shared/agent/agent.schema';
interface FunctionCall {
	function_name: string;
	parameters: Record<string, any>;
	stdout?: string | null;
	stderr?: string | null;
	timestamp: number;
	execution_id: string;
}

interface AgentContextApi {
	agentId: string;
	type: string;
	subtype?: string;
	executionId: string;
	functionCallHistory?: FunctionCall[] | null;
}

const mockFunctionCall1: FunctionCall = {
	function_name: 'short_param_func',
	parameters: { p1: 'short_value' },
	stdout: 'This is output 1.',
	stderr: null,
	timestamp: Date.now(),
	execution_id: 'exec1',
};

const longString = `${'long_'.repeat(50)}value`; // > 200 chars
const mockFunctionCall2: FunctionCall = {
	function_name: 'long_param_func',
	parameters: { longP: longString },
	stdout: null,
	stderr: 'Error occurred here.',
	timestamp: Date.now() - 1000,
	execution_id: 'exec2',
};

// Component reverses history, so mockFunctionCall2 will be displayed first in UI
const mockAgentDetailsWithCalls: AgentContextApi = {
	agentId: 'agent-123',
	type: 'autonomous',
	executionId: 'main-exec',
	functionCallHistory: [mockFunctionCall1, mockFunctionCall2],
};

const mockAgentDetailsNoCalls: AgentContextApi = {
	agentId: 'agent-456',
	type: 'autonomous',
	executionId: 'main-exec-no-calls',
	functionCallHistory: [],
};

const mockAgentDetailsNullHistory: AgentContextApi = {
	agentId: 'agent-789',
	type: 'autonomous',
	executionId: 'main-exec-null-hist',
	functionCallHistory: null,
};

xdescribe('AgentFunctionCallsComponent', () => {
	let component: AgentFunctionCallsComponent;
	let fixture: ComponentFixture<AgentFunctionCallsComponent>;
	let po: AgentFunctionCallsPo;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [
				AgentFunctionCallsComponent, // Standalone component
				NoopAnimationsModule,
			],
		}).compileComponents();

		fixture = TestBed.createComponent(AgentFunctionCallsComponent);
		component = fixture.componentInstance;
		po = await AgentFunctionCallsPo.create(fixture);
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	describe('Display Logic', () => {
		it('should display no function call items if history is empty', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsNoCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems();
			expect(items.length).toBe(0);
		});

		it('should display no function call items if history is null', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsNullHistory);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems();
			expect(items.length).toBe(0);
		});

		it('should display function calls when history is provided', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems();
			expect(items.length).toBe(2);
		});

		it('should display function names correctly (respecting component reverse logic)', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems();
			// mockFunctionCall2 is first in history, so it's displayed first due to slice().reverse()
			expect(await po.getFunctionName(items[0])).toBe(mockFunctionCall2.function_name);
			expect(await po.getFunctionName(items[1])).toBe(mockFunctionCall1.function_name);
		});

		it('should display short parameters directly', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems(); // items[1] is mockFunctionCall1
			const paramItems = await po.getParameterItems(items[1]);
			expect(paramItems.length).toBe(1);
			expect(await po.getParameterKey(paramItems[0])).toBe('p1');
			expect(await po.isParameterLong(paramItems[0])).toBe(false);
			expect(await po.getParameterValue(paramItems[0])).toBe('short_value');
		});

		it('should display long parameters in an expandable panel, initially showing truncated value', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems(); // items[0] is mockFunctionCall2
			const paramItems = await po.getParameterItems(items[0]);
			expect(paramItems.length).toBe(1);
			expect(await po.getParameterKey(paramItems[0])).toBe('longP');
			expect(await po.isParameterLong(paramItems[0])).toBe(true);
			const shortValue = await po.getParameterValueShort(paramItems[0]);
			expect(shortValue).toContain('long_long_');
			expect(shortValue?.endsWith('...')).toBe(true);
			expect(shortValue?.length).toBeLessThanOrEqual(200 + 3); // 200 chars + '...'
		});

		it('should expand long parameter panel and show full value', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems(); // items[0] is mockFunctionCall2
			const paramItems = await po.getParameterItems(items[0]);
			const fullValue = await po.getParameterValue(paramItems[0]); // This expands the panel
			expect(fullValue).toBe(longString);
		});

		it('should display stdout in an expandable panel and allow expansion', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems(); // items[1] is mockFunctionCall1
			const stdoutPanel = await po.getStdoutPanel(items[1]);
			expect(stdoutPanel).toBeTruthy();
			if (stdoutPanel) {
				expect(await stdoutPanel.isExpanded()).toBe(false);
				expect(await stdoutPanel.getTitle()).toBe('Output');
				const content = await po.getPanelContent(stdoutPanel); // This expands
				expect(content).toBe(mockFunctionCall1.stdout);
				expect(await stdoutPanel.isExpanded()).toBe(true);
			}
		});

		it('should display stderr in an expandable panel and allow expansion', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems(); // items[0] is mockFunctionCall2
			const stderrPanel = await po.getStderrPanel(items[0]);
			expect(stderrPanel).toBeTruthy();
			if (stderrPanel) {
				expect(await stderrPanel.isExpanded()).toBe(false);
				expect(await stderrPanel.getTitle()).toBe('Errors');
				const content = await po.getPanelContent(stderrPanel); // This expands
				expect(content).toBe(mockFunctionCall2.stderr);
				expect(await stderrPanel.isExpanded()).toBe(true);
			}
		});

		it('should not display stdout panel if stdout is null or empty', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems(); // items[0] is mockFunctionCall2 (no stdout)
			const stdoutPanel = await po.getStdoutPanel(items[0]);
			expect(stdoutPanel).toBeNull();
		});

		it('should not display stderr panel if stderr is null or empty', async () => {
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithCalls);
			await po.detectAndWait();
			const items = await po.getFunctionCallItems(); // items[1] is mockFunctionCall1 (no stderr)
			const stderrPanel = await po.getStderrPanel(items[1]);
			expect(stderrPanel).toBeNull();
		});
	});
});
