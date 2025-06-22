import { ComponentFixture } from '@angular/core/testing';
import { MatRadioButtonHarness } from '@angular/material/radio/testing';
import { MatRadioGroupHarness } from '@angular/material/radio/testing';
import { BaseSpecPo } from '../../../../test/base.po';
import type { NewAgentComponent } from './new-agent.component';

export class NewAgentPo extends BaseSpecPo<NewAgentComponent> {
	private ids = {
		autonomousAgentRadio: 'autonomous-agent-radio',
		workflowsAgentRadio: 'workflows-agent-radio',
		stubAutonomousAgent: 'stub-autonomous-agent', // data-testid for the stub component
		stubWorkflowsAgent: 'stub-workflows-agent', // data-testid for the stub component
	} as const;

	// State Queries
	async getSelectedAgentType(): Promise<string | null> {
		const radioGroup = await this.loader.getHarness(MatRadioGroupHarness); // Assuming one radio group
		const checkedButton = await radioGroup.getCheckedRadioButton();
		return checkedButton ? checkedButton.getValue() : null;
	}

	async isAutonomousAgentStubVisible(): Promise<boolean> {
		return this.has(this.ids.stubAutonomousAgent);
	}

	async isWorkflowsAgentStubVisible(): Promise<boolean> {
		return this.has(this.ids.stubWorkflowsAgent);
	}

	// User Actions
	async selectAgentType(type: 'autonomous' | 'workflow'): Promise<void> {
		const targetRadioId = type === 'autonomous' ? this.ids.autonomousAgentRadio : this.ids.workflowsAgentRadio;
		const radioButton = await this.loader.getHarness(MatRadioButtonHarness.with({ selector: `[data-testid="${targetRadioId}"]` }));
		await radioButton.check();
		await this.detectAndWait();
	}
}
