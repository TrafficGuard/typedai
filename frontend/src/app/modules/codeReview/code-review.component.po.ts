import { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatPaginatorHarness } from '@angular/material/paginator/testing';
import { MatTableHarness } from '@angular/material/table/testing';
import { By } from '@angular/platform-browser';

import { BaseSpecPo } from '../../../test/base.po';
import type { CodeReviewComponent } from './code-review.component';

export class CodeReviewPo extends BaseSpecPo<CodeReviewComponent> {
	private ids = {
		createReviewButton: 'create-review-button',
		reviewsTable: 'reviews-table',
		searchInput: 'search-input',
		filterMenuButton: 'filter-menu-button',
		reviewsPaginator: 'reviews-paginator',
	} as const;

	// Example User Actions

	async clickCreateReviewButton(): Promise<void> {
		await this.click(this.ids.createReviewButton);
	}

	async setSearchText(text: string): Promise<void> {
		const inputHarness = await this.loader.getHarness(MatInputHarness.with({ selector: `[data-testid="${this.ids.searchInput}"]` }));
		await inputHarness.setValue(text);
		await this.detectAndWait();
	}

	async openFilterMenu(): Promise<void> {
		await this.click(this.ids.filterMenuButton);
	}

	async selectFilterOption(optionText: string): Promise<void> {
		const menuHarness = await this.loader.getHarness(MatMenuHarness.with({ triggerText: /.*/ })); // Adjust selector as needed
		await menuHarness.open();
		await menuHarness.clickItem({ text: optionText });
		await this.detectAndWait();
	}

	async clickEditButtonForRow(rowIndex: number): Promise<void> {
		const table = await this.loader.getHarness(MatTableHarness.with({ selector: `[data-testid="${this.ids.reviewsTable}"]` }));
		const rows = await table.getRows();
		if (rows.length <= rowIndex) {
			throw new Error(`Row index ${rowIndex} is out of bounds. Table has ${rows.length} rows.`);
		}
		const targetRow = rows[rowIndex];
		// Assuming the edit button can be found by text 'Edit' within the row.
		// This might need a more specific selector or data-testid on the button itself.
		const editButton = await targetRow.getHarness(MatButtonHarness.with({ text: 'Edit' }));
		await editButton.click();
		await this.detectAndWait();
	}

	async clickDeleteButtonForRow(rowIndex: number): Promise<void> {
		const table = await this.loader.getHarness(MatTableHarness.with({ selector: `[data-testid="${this.ids.reviewsTable}"]` }));
		const rows = await table.getRows();
		if (rows.length <= rowIndex) {
			throw new Error(`Row index ${rowIndex} is out of bounds. Table has ${rows.length} rows.`);
		}
		const targetRow = rows[rowIndex];
		// Assuming the delete button can be found by text 'Delete' within the row.
		const deleteButton = await targetRow.getHarness(MatButtonHarness.with({ text: 'Delete' }));
		await deleteButton.click();
		await this.detectAndWait();
	}

	// Example State Queries

	async getSearchInputValue(): Promise<string> {
		const inputHarness = await this.loader.getHarness(MatInputHarness.with({ selector: `[data-testid="${this.ids.searchInput}"]` }));
		return inputHarness.getValue();
	}

	async isTableVisible(): Promise<boolean> {
		const tables = await this.loader.getAllHarnesses(MatTableHarness.with({ selector: `[data-testid="${this.ids.reviewsTable}"]` }));
		return tables.length > 0;
	}

	async getTableRowsCount(): Promise<number> {
		const table = await this.loader.getHarness(MatTableHarness.with({ selector: `[data-testid="${this.ids.reviewsTable}"]` }));
		const rows = await table.getRows();
		return rows.length;
	}

	async getPaginatorPageSize(): Promise<number> {
		const paginator = await this.loader.getHarness(MatPaginatorHarness.with({ selector: `[data-testid="${this.ids.reviewsPaginator}"]` }));
		return paginator.getPageSize();
	}

	async goToNextPagePaginator(): Promise<void> {
		const paginator = await this.loader.getHarness(MatPaginatorHarness.with({ selector: `[data-testid="${this.ids.reviewsPaginator}"]` }));
		await paginator.goToNextPage();
		await this.detectAndWait();
	}

	// Constructor and static create method are inherited from BaseSpecPo.
}
