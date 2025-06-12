import type { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';

import { BaseSpecPo } from '../../../../../test/base.po';
import type { NewWorkflowsAgentComponent } from './new-workflows-agent.component';

export class NewWorkflowsAgentPo extends BaseSpecPo<NewWorkflowsAgentComponent> {
	private readonly ids = {
		workingDirectorySelect: 'working-directory-select',
		workflowTypeSelect: 'workflow-type-select',
		workflowInputElement: 'workflow-input-element',
		workflowInputLabel: 'workflow-input-label',
		submitButton: 'submit-button',
		resultArea: 'result-area',
		loadingIndicator: 'loading-indicator',
	} as const;

	// State Query Methods
	async getWorkingDirectoryValue(): Promise<string | null> {
		const select = await this.harness(MatSelectHarness, { selector: `[data-testid="${this.ids.workingDirectorySelect}"]` });
		return select.getValueText();
	}

	async getWorkflowTypeValue(): Promise<string | null> {
		const select = await this.harness(MatSelectHarness, { selector: `[data-testid="${this.ids.workflowTypeSelect}"]` });
		return select.getValueText(); // Assuming value text is what we need, or .getValue() if actual value attribute
	}

	async getInputValue(): Promise<string> {
		const input = await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.workflowInputElement}"]` });
		return input.getValue();
	}

	async getInputLabelText(): Promise<string | null> {
		if (this.has(this.ids.workflowInputLabel)) {
			return this.text(this.ids.workflowInputLabel);
		}
		return null;
	}

	async isSubmitButtonEnabled(): Promise<boolean> {
		const button = await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.submitButton}"]` });
		return !(await button.isDisabled());
	}

	async getResultText(): Promise<string | null> {
		if (this.has(this.ids.resultArea)) {
			return this.text(this.ids.resultArea);
		}
		return null;
	}

	async isLoadingIndicatorVisible(): Promise<boolean> {
		return this.has(this.ids.loadingIndicator);
	}

	// Action Methods
	async selectWorkingDirectory(optionText: string): Promise<void> {
		const select = await this.harness(MatSelectHarness, { selector: `[data-testid="${this.ids.workingDirectorySelect}"]` });
		await select.open();
		await select.clickOptions({ text: optionText });
		await this.detectAndWait();
	}

	async selectWorkflowType(optionText: string): Promise<void> {
		const select = await this.harness(MatSelectHarness, { selector: `[data-testid="${this.ids.workflowTypeSelect}"]` });
		await select.open();
		await select.clickOptions({ text: optionText }); // Assuming optionText is the user-visible text
		await this.detectAndWait();
	}

	async typeInInput(text: string): Promise<void> {
		const input = await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.workflowInputElement}"]` });
		await input.setValue(text);
		await this.detectAndWait();
	}

	async clickSubmitButton(): Promise<void> {
		const button = await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.submitButton}"]` });
		await button.click();
		await this.detectAndWait();
	}

	// Helper to set form values for valid submission
	async setValidFormValues(values: {
		workingDirectory: string;
		workflowType: string; // This should be the text of the option
		input: string;
	}): Promise<void> {
		await this.selectWorkingDirectory(values.workingDirectory);
		await this.selectWorkflowType(values.workflowType);
		await this.typeInInput(values.input);
	}
}
