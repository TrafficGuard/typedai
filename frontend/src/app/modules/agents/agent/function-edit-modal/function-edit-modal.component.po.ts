import type { TestElement } from '@angular/cdk/testing';
import { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatListHarness, type MatListItemHarness } from '@angular/material/list/testing';
import { BaseSpecPo } from '../../../../../test/base.po';
import type { FunctionEditModalComponent } from './function-edit-modal.component';

export class FunctionEditModalPo extends BaseSpecPo<FunctionEditModalComponent> {
	private ids = {
		searchInput: 'search-input',
		clearSearchButton: 'clear-search-button',
		functionList: 'function-list',
		saveButton: 'save-button',
		cancelButton: 'cancel-button',
		noResultsMessage: 'no-results-message',
		// Individual function items will be targeted by text using MatListItemHarness
	} as const;

	// --- Harness Getters ---

	async getSearchInputHarness(): Promise<MatInputHarness> {
		return this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.searchInput}"]` });
	}

	async getClearSearchButtonHarness(): Promise<MatButtonHarness | null> {
		const clearButtonExists = this.has(this.ids.clearSearchButton);
		if (!clearButtonExists) {
			return null;
		}
		return this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.clearSearchButton}"]` });
	}

	async getSaveButtonHarness(): Promise<MatButtonHarness> {
		return this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.saveButton}"]` });
	}

	async getCancelButtonHarness(): Promise<MatButtonHarness> {
		return this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.cancelButton}"]` });
	}

	async getFunctionListHarness(): Promise<MatListHarness> {
		return this.harness(MatListHarness, { selector: `[data-testid="${this.ids.functionList}"]` });
	}

	async getFunctionListItemHarnesses(): Promise<MatListItemHarness[]> {
		const listHarness = await this.getFunctionListHarness();
		return listHarness.getItems();
	}

	async getFunctionListItemHarnessByName(name: string): Promise<MatListItemHarness | null> {
		// MatListItemHarness does not directly support filtering by complex content,
		// so we get all items and filter by their text.
		// The data-testid="function-item-{{funcName}}" can be used for more direct selection if needed.
		const items = await this.getFunctionListItemHarnesses();
		for (const item of items) {
			const text = await item.getText();
			if (text.trim() === name) {
				return item;
			}
		}
		return null;
	}

	// --- User Actions ---

	async typeInSearch(term: string): Promise<void> {
		const inputHarness = await this.getSearchInputHarness();
		await inputHarness.setValue(term);
		await this.detectAndWait();
	}

	async clearSearch(): Promise<void> {
		const clearButtonHarness = await this.getClearSearchButtonHarness();
		if (clearButtonHarness) {
			await clearButtonHarness.click();
			await this.detectAndWait();
		}
	}

	async clickFunctionByName(name: string): Promise<void> {
		const itemHarness = await this.getFunctionListItemHarnessByName(name);
		if (itemHarness) {
			// await itemHarness.click(); // invalid
			// await this.detectAndWait();
			throw new Error('TODO implement clickFunctionByName()')
		} else {
			throw new Error(`Function item with name "${name}" not found.`);
		}
	}

	async clickSave(): Promise<void> {
		const saveButtonHarness = await this.getSaveButtonHarness();
		await saveButtonHarness.click();
		await this.detectAndWait();
	}

	async clickCancel(): Promise<void> {
		const cancelButtonHarness = await this.getCancelButtonHarness();
		await cancelButtonHarness.click();
		await this.detectAndWait();
	}

	// --- State Queries ---

	async getSearchTerm(): Promise<string> {
		const inputHarness = await this.getSearchInputHarness();
		return inputHarness.getValue();
	}

	async getDisplayedFunctionNames(): Promise<string[]> {
		const itemHarnesses = await this.getFunctionListItemHarnesses();
		const names: string[] = [];
		for (const item of itemHarnesses) {
			// The item text might include the "check" icon text if not handled carefully.
			// Assuming the primary text is what we need. MatListItemHarness.getText() usually gets the main content.
			// If item has subtext or icons, getText() behavior needs to be checked.
			// The template is `{{ func }} <mat-icon *ngIf="selected">check</mat-icon>`.
			// Harness getText() should get "func". If it includes "check", we'll need to refine.
			// For now, assume getText() is sufficient.
			const fullText = await item.getText();
			// If 'check' is part of the text, remove it.
			names.push(fullText.replace(/check$/, '').trim());
		}
		return names;
	}

	async isFunctionSelected(name: string): Promise<boolean> {
		const itemHarness = await this.getFunctionListItemHarnessByName(name);
		if (itemHarness) {
			const hostElement: TestElement = await itemHarness.host();
			return hostElement.hasClass('selected');
		}
		return false;
	}

	async getNoResultsMessageText(): Promise<string | null> {
		if (this.has(this.ids.noResultsMessage)) {
			return this.text(this.ids.noResultsMessage);
		}
		return null;
	}

	async isSaveButtonDisabled(): Promise<boolean> {
		const saveButtonHarness = await this.getSaveButtonHarness();
		return saveButtonHarness.isDisabled();
	}
}
