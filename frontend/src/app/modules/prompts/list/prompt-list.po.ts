import { type ComponentFixture } from '@angular/core/testing';
import { MatRowHarness, MatTableHarness } from '@angular/material/table/testing';
import { BaseSpecPo } from '../../../../test/base.po';
import type { PromptListComponent } from './prompt-list.component';

export class PromptListPo extends BaseSpecPo<PromptListComponent> {
	private readonly ids = {
		loadingView: 'loading-view',
		errorView: 'error-view',
		noPromptsView: 'no-prompts-view',
		promptsTable: 'prompts-table',
		newPromptButton: 'new-prompt-btn',
		refreshButton: 'refresh-btn',
	} as const;

	// State queries
	isLoading() {
		return this.has(this.ids.loadingView);
	}
	isError() {
		return this.has(this.ids.errorView);
	}
	isTableVisible() {
		return this.has(this.ids.promptsTable);
	}
	isNoPromptsViewVisible() {
		return this.has(this.ids.noPromptsView);
	}

	async getTable(): Promise<MatTableHarness> {
		return this.harness(MatTableHarness, { selector: `[data-testid="${this.ids.promptsTable}"]` });
	}

	async getRows(): Promise<MatRowHarness[]> {
		const table = await this.getTable();
		return table.getRows();
	}

	async getRowCount(): Promise<number> {
		return (await this.getRows()).length;
	}

	async getRowText(rowIndex: number): Promise<string> {
		const rows = await this.getRows();
		if (rows.length <= rowIndex) {
			throw new Error(`Row index ${rowIndex} is out of bounds.`);
		}
		return rows[rowIndex].getText();
	}

	async isDeleteSpinnerVisible(promptId: string): Promise<boolean> {
		return this.has(`delete-spinner-${promptId}`);
	}

	// User actions
	async clickNewPrompt() {
		await this.click(this.ids.newPromptButton);
	}

	async clickRefresh() {
		await this.click(this.ids.refreshButton);
	}

	async clickRow(rowIndex: number) {
		const rows = await this.getRows();
		await rows[rowIndex].host().then((h) => h.click());
		await this.detectAndWait();
	}

	async clickEdit(promptId: string) {
		await this.click(`edit-btn-${promptId}`);
	}

	async clickDelete(promptId: string) {
		await this.click(`delete-btn-${promptId}`);
	}
}
