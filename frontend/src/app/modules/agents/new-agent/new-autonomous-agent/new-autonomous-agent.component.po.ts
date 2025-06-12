import { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { BaseSpecPo } from '../../../../../test/base.po';
import type { NewAutonomousAgentComponent } from './new-autonomous-agent.component';

export class NewAutonomousAgentPo extends BaseSpecPo<NewAutonomousAgentComponent> {
	// Define data-testid values for elements in the component's template
	private readonly ids = {
		form: 'new-agent-form',
		nameInput: 'agent-name-input',
		userPromptTextarea: 'user-prompt-textarea',
		subtypeSelect: 'subtype-select',
		llmEasySelect: 'llm-easy-select',
		llmMediumSelect: 'llm-medium-select',
		llmHardSelect: 'llm-hard-select',
		budgetInput: 'budget-input',
		countInput: 'count-input',
		useSharedReposCheckbox: 'use-shared-repos-checkbox',
		// Preset buttons - assuming preset names are part of the data-testid
		presetClaudeVertexButton: 'preset-claude-vertex-button',
		presetClaudeButton: 'preset-claude-button',
		presetGeminiButton: 'preset-gemini-button',
		presetOpenaiButton: 'preset-openai-button',
		submitButton: 'submit-button',
		loadingSpinner: 'loading-spinner', // For the MatProgressSpinner shown during submission
		// Function checkboxes will be identified by index, e.g., 'function-checkbox-0'
		functionCheckboxPrefix: 'function-checkbox-',
	} as const;

	// Static create method is inherited from BaseSpecPo

	// --- Query Methods ---

	async getNameInputValue(): Promise<string> {
		return (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.nameInput}"]` })).getValue();
	}

	async getUserPromptValue(): Promise<string> {
		return (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.userPromptTextarea}"]` })).getValue();
	}

	async getSelectedSubtype(): Promise<string> {
		return (await this.harness(MatSelectHarness, { selector: `[data-testid="${this.ids.subtypeSelect}"]` })).getValueText();
	}

	async getSelectedLlm(llmType: 'easy' | 'medium' | 'hard'): Promise<string> {
		const selector = llmType === 'easy' ? this.ids.llmEasySelect : llmType === 'medium' ? this.ids.llmMediumSelect : this.ids.llmHardSelect;
		return (await this.harness(MatSelectHarness, { selector: `[data-testid="${selector}"]` })).getValueText();
	}

	async getBudgetValue(): Promise<string> {
		return (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.budgetInput}"]` })).getValue();
	}

	async getCountValue(): Promise<string> {
		return (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.countInput}"]` })).getValue();
	}

	private getFunctionCheckboxDataTestId(index: number): string {
		return `${this.ids.functionCheckboxPrefix}${index}`;
	}

	async isFunctionCheckboxPresent(index: number): Promise<boolean> {
		const checkboxes = await this.loader.getAllHarnesses(MatCheckboxHarness.with({ selector: `[data-testid="${this.getFunctionCheckboxDataTestId(index)}"]` }));
		return checkboxes.length > 0;
	}

	async isFunctionCheckboxChecked(index: number): Promise<boolean> {
		return (
			await this.harness(MatCheckboxHarness, {
				selector: `[data-testid="${this.getFunctionCheckboxDataTestId(index)}"]`,
			})
		).isChecked();
	}

	async isUseSharedReposChecked(): Promise<boolean> {
		return (await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.useSharedReposCheckbox}"]` })).isChecked();
	}

	async isUseSharedReposEnabled(): Promise<boolean> {
		return !(await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.useSharedReposCheckbox}"]` })).isDisabled();
	}

	async isSubmitButtonEnabled(): Promise<boolean> {
		return !(await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.submitButton}"]` })).isDisabled();
	}

	async isLoadingSpinnerVisible(): Promise<boolean> {
		// Assuming the spinner has a data-testid. BaseSpecPo.has() can be used.
		return this.has(this.ids.loadingSpinner);
	}

	// --- Action Methods ---

	async setNameInputValue(name: string): Promise<void> {
		await (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.nameInput}"]` })).setValue(name);
	}

	async setUserPromptValue(prompt: string): Promise<void> {
		await (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.userPromptTextarea}"]` })).setValue(prompt);
	}

	async selectSubtype(subtypeText: string): Promise<void> {
		const select = await this.harness(MatSelectHarness, { selector: `[data-testid="${this.ids.subtypeSelect}"]` });
		await select.open();
		await select.clickOptions({ text: subtypeText });
	}

	async selectLlm(llmType: 'easy' | 'medium' | 'hard', llmOptionText: string): Promise<void> {
		const selector = llmType === 'easy' ? this.ids.llmEasySelect : llmType === 'medium' ? this.ids.llmMediumSelect : this.ids.llmHardSelect;
		const select = await this.harness(MatSelectHarness, { selector: `[data-testid="${selector}"]` });
		await select.open();
		// Assuming llmOptionText is the display name of the LLM in the dropdown
		await select.clickOptions({ text: llmOptionText });
	}

	async setBudgetValue(value: string | number): Promise<void> {
		await (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.budgetInput}"]` })).setValue(String(value));
	}

	async setCountValue(value: string | number): Promise<void> {
		await (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.countInput}"]` })).setValue(String(value));
	}

	async checkFunctionCheckbox(index: number, checked: boolean): Promise<void> {
		const checkbox = await this.harness(MatCheckboxHarness, {
			selector: `[data-testid="${this.getFunctionCheckboxDataTestId(index)}"]`,
		});
		if (checked) {
			await checkbox.check();
		} else {
			await checkbox.uncheck();
		}
	}

	async checkUseSharedRepos(checked: boolean): Promise<void> {
		const checkbox = await this.harness(MatCheckboxHarness, {
			selector: `[data-testid="${this.ids.useSharedReposCheckbox}"]`,
		});
		if (checked) {
			await checkbox.check();
		} else {
			await checkbox.uncheck();
		}
	}

	async clickPresetButton(presetName: 'claude-vertex' | 'claude' | 'gemini' | 'openai'): Promise<void> {
		let buttonId: string;
		switch (presetName) {
			case 'claude-vertex':
				buttonId = this.ids.presetClaudeVertexButton;
				break;
			case 'claude':
				buttonId = this.ids.presetClaudeButton;
				break;
			case 'gemini':
				buttonId = this.ids.presetGeminiButton;
				break;
			case 'openai':
				buttonId = this.ids.presetOpenaiButton;
				break;
		}
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${buttonId}"]` })).click();
	}

	async clickSubmitButton(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.submitButton}"]` })).click();
	}
}
