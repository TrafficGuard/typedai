import { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatExpansionPanelHarness } from '@angular/material/expansion/testing';
import { MatProgressSpinnerHarness } from '@angular/material/progress-spinner/testing';
import { By } from '@angular/platform-browser';
import { BaseSpecPo } from '../../../test/base.po';
import type { CodeTaskComponent } from './codeTask.component';

export class CodeTaskPo extends BaseSpecPo<CodeTaskComponent> {
	private ids = {
		title: 'code-task-title',
		statusText: 'code-task-status-text',
		loadingSpinner: 'loading-spinner',
		errorMessageDisplay: 'error-message-display',
		notFoundMessage: 'not-found-message',
		forbiddenMessage: 'forbidden-message',
		instructionsPanel: 'instructions-panel',
		instructionsPanelHeader: 'instructions-panel-header',
		fileSelectionComponent: 'file-selection-component',
		resetSelectionButton: 'reset-selection-button',
	} as const;

	// --- State Queries ---
	async isLoading(): Promise<boolean> {
		const spinners = await this.loader.getAllHarnesses(MatProgressSpinnerHarness.with({ selector: `[data-testid="${this.ids.loadingSpinner}"]` }));
		return spinners.length > 0;
	}

	getTaskTitle(): string {
		return this.text(this.ids.title);
	}

	getStatusText(): string {
		return this.text(this.ids.statusText);
	}

	isErrorMessageVisible(): boolean {
		return this.has(this.ids.errorMessageDisplay);
	}

	getErrorMessageText(): string {
		if (this.isErrorMessageVisible()) {
			return this.text(this.ids.errorMessageDisplay);
		}
		return '';
	}

	isNotFoundMessageVisible(): boolean {
		return this.has(this.ids.notFoundMessage);
	}

	isForbiddenMessageVisible(): boolean {
		return this.has(this.ids.forbiddenMessage);
	}

	async isInstructionsPanelPresent(): Promise<boolean> {
		const panels = await this.loader.getAllHarnesses(MatExpansionPanelHarness.with({ selector: `[data-testid="${this.ids.instructionsPanel}"]` }));
		return panels.length > 0;
	}

	async isInstructionsPanelExpanded(): Promise<boolean> {
		if (await this.isInstructionsPanelPresent()) {
			const panel = await this.loader.getHarness(MatExpansionPanelHarness.with({ selector: `[data-testid="${this.ids.instructionsPanel}"]` }));
			return panel.isExpanded();
		}
		return false;
	}

	isFileSelectionAreaPresent(): boolean {
		return this.has(this.ids.fileSelectionComponent);
	}

	async isResetSelectionButtonPresent(): Promise<boolean> {
		const buttons = await this.loader.getAllHarnesses(MatButtonHarness.with({ selector: `[data-testid="${this.ids.resetSelectionButton}"]` }));
		return buttons.length > 0;
	}

	async isResetSelectionButtonDisabled(): Promise<boolean> {
		if (await this.isResetSelectionButtonPresent()) {
			const button = await this.loader.getHarness(MatButtonHarness.with({ selector: `[data-testid="${this.ids.resetSelectionButton}"]` }));
			return button.isDisabled();
		}
		return true; // If not present, effectively disabled for interaction
	}

	// --- User Actions ---
	async toggleInstructionsPanel(): Promise<void> {
		if (await this.isInstructionsPanelPresent()) {
			// Clicking the header directly as MatExpansionPanelHarness.toggle() might not always work as expected
			// depending on internal structure or if events are stopped.
			// Using base click method for reliability.
			await this.click(this.ids.instructionsPanelHeader);
		}
	}

	async clickResetSelectionButton(): Promise<void> {
		if (await this.isResetSelectionButtonPresent()) {
			const button = await this.loader.getHarness(MatButtonHarness.with({ selector: `[data-testid="${this.ids.resetSelectionButton}"]` }));
			await button.click();
		}
	}
}
