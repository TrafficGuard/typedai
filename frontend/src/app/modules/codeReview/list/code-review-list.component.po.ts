import { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatProgressBarHarness } from '@angular/material/progress-bar/testing';
import { MatProgressSpinnerHarness } from '@angular/material/progress-spinner/testing';
import { type MatRowHarness, MatTableHarness } from '@angular/material/table/testing';
import { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import { BaseSpecPo } from '../../../../test/base.po';
import type { CodeReviewListComponent } from './code-review-list.component';

export class CodeReviewListPo extends BaseSpecPo<CodeReviewListComponent> {
	private ids = {
		refreshButton: 'refresh-button',
		newConfigButton: 'new-config-button',
		deleteSelectedButton: 'delete-selected-button',
		configsTable: 'configs-table',
		masterCheckbox: 'master-checkbox',
		rowCheckboxPrefix: 'row-checkbox-', // For data-testid="row-checkbox-{{config.id}}"
		editConfigPrefix: 'edit-config-', // For data-testid="edit-config-{{config.id}}"
		loadingIndicator: 'loading-indicator', // Used for both mat-progress-bar and mat-spinner
		errorMessageDisplay: 'error-message-display',
		noConfigsMessage: 'no-configs-message',
	} as const;

	// --- State Queries ---

	async isLoading(): Promise<boolean> {
		// Check for either the top progress bar or the central spinner
		const progressBars = await this.loader.getAllHarnesses(MatProgressBarHarness.with({ selector: `[data-testid="${this.ids.loadingIndicator}"]` }));
		if (progressBars.length > 0) return true;
		const spinners = await this.loader.getAllHarnesses(MatProgressSpinnerHarness.with({ selector: `[data-testid="${this.ids.loadingIndicator}"]` }));
		return spinners.length > 0;
	}

	async getErrorMessage(): Promise<string | null> {
		try {
			// Ensure the element exists before trying to get text
			if (this.has(this.ids.errorMessageDisplay)) {
				return this.text(this.ids.errorMessageDisplay);
			}
			return null;
		} catch (e) {
			return null; // Element not found
		}
	}

	async getNoConfigsMessage(): Promise<string | null> {
		try {
			if (this.has(this.ids.noConfigsMessage)) {
				return this.text(this.ids.noConfigsMessage);
			}
			return null;
		} catch (e) {
			return null;
		}
	}

	private async getTableHarness(): Promise<MatTableHarness | null> {
		try {
			return await this.harness(MatTableHarness, { selector: `[data-testid="${this.ids.configsTable}"]` });
		} catch {
			return null; // Table not found
		}
	}

	async getRowCount(): Promise<number> {
		const table = await this.getTableHarness();
		if (!table) return 0;
		const rows = await table.getRows();
		return rows.length;
	}

	async getRowData(rowIndex: number): Promise<{ title: string; description: string; enabled: string } | null> {
		const table = await this.getTableHarness();
		if (!table) return null;

		const rows = await table.getRows();
		if (rowIndex >= rows.length) {
			throw new Error(`Row index ${rowIndex} out of bounds.`);
		}
		// Column definitions in component: 'title', 'description', 'enabled', 'select'
		const cells = await rows[rowIndex].getCellTextByIndex();
		return {
			title: cells[0],
			description: cells[1],
			enabled: cells[2], // This will be 'Yes' or 'No' as per template
		};
	}

	async isMasterCheckboxChecked(): Promise<boolean> {
		const checkbox = await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.masterCheckbox}"]` });
		return checkbox.isChecked();
	}

	async isRowCheckboxCheckedById(configId: string): Promise<boolean> {
		const checkbox = await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.rowCheckboxPrefix}${configId}"]` });
		return checkbox.isChecked();
	}

	async isDeleteButtonEnabled(): Promise<boolean> {
		const button = await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.deleteSelectedButton}"]` });
		return !(await button.isDisabled());
	}

	// --- User Actions ---

	async clickRefreshButton(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.refreshButton}"]` })).click();
	}

	async clickNewConfigButton(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.newConfigButton}"]` })).click();
	}

	async clickDeleteSelectedButton(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.deleteSelectedButton}"]` })).click();
	}

	async clickMasterCheckbox(): Promise<void> {
		await (await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.masterCheckbox}"]` })).toggle();
	}

	async clickRowCheckboxById(configId: string): Promise<void> {
		await (await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.rowCheckboxPrefix}${configId}"]` })).toggle();
	}

	async clickEditConfigLink(configId: string): Promise<void> {
		// This is an <a> tag, not a Material button
		await this.click(`${this.ids.editConfigPrefix}${configId}`);
	}

	// Helper to get cell text by column name for a specific row using MatRowHarness
	async getCellTextFromRowByColumnName(row: MatRowHarness, columnName: string): Promise<string> {
		return (await row.getCellTextByColumnName())[columnName];
	}

	async getAllRows(): Promise<MatRowHarness[]> {
		const table = await this.getTableHarness();
		if (!table) return [];
		return table.getRows();
	}
}
