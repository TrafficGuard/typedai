import { ENTER } from '@angular/cdk/keycodes';
import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatChipInputHarness } from '@angular/material/chips/testing';
import { MatChipListboxHarness, type MatChipOptionHarness } from '@angular/material/chips/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { BaseSpecPo } from '../../../../test/base.po';
import type { CodeReviewEditComponent } from './code-review-edit.component';

export class CodeReviewEditPo extends BaseSpecPo<CodeReviewEditComponent> {
	private ids = {
		pageHeader: 'page-header', // Assume data-testid="page-header" on <h1>
		loadingIndicator: 'loading-indicator', // Assume data-testid="loading-indicator" on mat-progress-spinner
		errorMessage: 'error-message', // Assume data-testid="error-message" on error div

		titleInput: 'title-input',
		enabledCheckbox: 'enabled-checkbox',
		descriptionInput: 'description-input',

		fileExtensionsChips: 'file-extensions-include-chips',
		fileExtensionsInput: 'file-extensions-include-input',
		requiresTextChips: 'requires-text-chips',
		requiresTextInput: 'requires-text-input',
		tagsChips: 'tags-chips',
		tagsInput: 'tags-input',
		projectPathsChips: 'project-paths-chips',
		projectPathsInput: 'project-paths-input',

		exampleCodeInputPrefix: 'example-code-input-',
		exampleReviewCommentInputPrefix: 'example-review-comment-input-',
		removeExampleButtonPrefix: 'remove-example-button-',
		addExampleButton: 'add-example-button',

		saveButton: 'save-button',
		cancelButton: 'cancel-button',
	} as const;

	// --- State Queries ---
	async getPageTitleText(): Promise<string> {
		// Assumes h1 has data-testid="page-header"
		// Alternatively, access component signal if DOM testing is not strict: return this.componentInstance.pageTitle();
		return this.text(this.ids.pageHeader);
	}

	async isLoadingIndicatorVisible(): Promise<boolean> {
		return this.has(this.ids.loadingIndicator);
	}

	async getErrorMessageText(): Promise<string | null> {
		if (await this.has(this.ids.errorMessage)) {
			return this.text(this.ids.errorMessage);
		}
		return null;
	}

	async getTitleValue(): Promise<string> {
		return (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.titleInput}"]` })).getValue();
	}

	async isEnabled(): Promise<boolean> {
		return (await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.enabledCheckbox}"]` })).isChecked();
	}

	async getDescriptionValue(): Promise<string> {
		return (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.descriptionInput}"]` })).getValue();
	}

	private async getChipValues(chipListTestId: string): Promise<string[]> {
		const chipList = await this.harness(MatChipListboxHarness, { selector: `[data-testid="${chipListTestId}"]` });
		const chips = await chipList.getChips();
		return Promise.all(chips.map((chip) => chip.getText()));
	}

	getFileExtensions(): Promise<string[]> {
		return this.getChipValues(this.ids.fileExtensionsChips);
	}
	getRequiresTexts(): Promise<string[]> {
		return this.getChipValues(this.ids.requiresTextChips);
	}
	getTags(): Promise<string[]> {
		return this.getChipValues(this.ids.tagsChips);
	}
	getProjectPaths(): Promise<string[]> {
		return this.getChipValues(this.ids.projectPathsChips);
	}

	async getExampleCodeValue(index: number): Promise<string> {
		const testId = `${this.ids.exampleCodeInputPrefix}${index}`;
		return (await this.harness(MatInputHarness, { selector: `[data-testid="${testId}"]` })).getValue();
	}

	async getExampleReviewCommentValue(index: number): Promise<string> {
		const testId = `${this.ids.exampleReviewCommentInputPrefix}${index}`;
		return (await this.harness(MatInputHarness, { selector: `[data-testid="${testId}"]` })).getValue();
	}

	async getExamplesCount(): Promise<number> {
		// Examples are in a FormArray, rendered with *ngFor.
		// We can count one of the consistent elements, e.g., remove buttons.
		const removeButtons = this.fix.debugElement.queryAll(By.css(`[data-testid^="${this.ids.removeExampleButtonPrefix}"]`));
		return removeButtons.length;
	}

	async isSaveButtonDisabled(): Promise<boolean> {
		return (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.saveButton}"]` })).isDisabled();
	}

	// --- User Actions ---
	async setTitle(value: string): Promise<void> {
		await (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.titleInput}"]` })).setValue(value);
		await this.detectAndWait();
	}

	async setEnabled(checked: boolean): Promise<void> {
		const checkbox = await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.enabledCheckbox}"]` });
		if (checked) {
			await checkbox.check();
		} else {
			await checkbox.uncheck();
		}
		await this.detectAndWait();
	}

	async setDescription(value: string): Promise<void> {
		await (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.descriptionInput}"]` })).setValue(value);
		await this.detectAndWait();
	}

	private async addChipToInput(chipInputTestId: string, value: string): Promise<void> {
		const chipInput = await this.harness(MatChipInputHarness, { selector: `[data-testid="${chipInputTestId}"]` });
		await chipInput.setValue(value);
		await chipInput.host().then((h) => h.sendKeys(ENTER)); // Simulate Enter to trigger (matChipInputTokenEnd)
		await this.detectAndWait();
	}

	addFileExtension(value: string): Promise<void> {
		return this.addChipToInput(this.ids.fileExtensionsInput, value);
	}
	addRequiresText(value: string): Promise<void> {
		return this.addChipToInput(this.ids.requiresTextInput, value);
	}
	addTag(value: string): Promise<void> {
		return this.addChipToInput(this.ids.tagsInput, value);
	}
	addProjectPath(value: string): Promise<void> {
		return this.addChipToInput(this.ids.projectPathsInput, value);
	}

	private async removeChipByText(chipListTestId: string, text: string): Promise<void> {
		const chipList = await this.harness(MatChipListboxHarness, { selector: `[data-testid="${chipListTestId}"]` });
		const chips = await chipList.getChips({ text } as any); // MatChipOptionHarnessFilters doesn't directly expose text filter, but underlying harness might support it.
		// Or iterate all chips and check text.
		if (chips.length > 0) {
			const chipToRemove = chips[0] as MatChipOptionHarness; // Assuming MatChipOptionHarness from listbox
			await chipToRemove.remove(); // This should trigger the (removed) event
			await this.detectAndWait();
		} else {
			// Fallback if direct text filter on getChips doesn't work as expected or for MatChipHarness
			const allChips = await chipList.getChips();
			for (const chip of allChips) {
				if ((await chip.getText()) === text) {
					await (chip as MatChipOptionHarness).remove();
					await this.detectAndWait();
					return;
				}
			}
		}
	}

	removeFileExtension(value: string): Promise<void> {
		return this.removeChipByText(this.ids.fileExtensionsChips, value);
	}
	removeRequiresText(value: string): Promise<void> {
		return this.removeChipByText(this.ids.requiresTextChips, value);
	}
	removeTagFromList(value: string): Promise<void> {
		return this.removeChipByText(this.ids.tagsChips, value);
	}
	removeProjectPathFromList(value: string): Promise<void> {
		return this.removeChipByText(this.ids.projectPathsChips, value);
	}

	async setExampleCode(index: number, value: string): Promise<void> {
		const testId = `${this.ids.exampleCodeInputPrefix}${index}`;
		await (await this.harness(MatInputHarness, { selector: `[data-testid="${testId}"]` })).setValue(value);
		await this.detectAndWait();
	}

	async setExampleReviewComment(index: number, value: string): Promise<void> {
		const testId = `${this.ids.exampleReviewCommentInputPrefix}${index}`;
		await (await this.harness(MatInputHarness, { selector: `[data-testid="${testId}"]` })).setValue(value);
		await this.detectAndWait();
	}

	async clickAddExample(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.addExampleButton}"]` })).click();
		await this.detectAndWait();
	}

	async clickRemoveExample(index: number): Promise<void> {
		const testId = `${this.ids.removeExampleButtonPrefix}${index}`;
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${testId}"]` })).click();
		await this.detectAndWait();
	}

	async clickSave(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.saveButton}"]` })).click();
		await this.detectAndWait(); // Wait for potential async operations triggered by save
	}

	async clickCancel(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.cancelButton}"]` })).click();
		await this.detectAndWait();
	}
}
