import type { TestElement } from '@angular/cdk/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { MatProgressSpinnerHarness } from '@angular/material/progress-spinner/testing';
import { MatHeaderRowHarness, type MatRowHarness, MatTableHarness } from '@angular/material/table/testing';
import { type AgentContextApi, FileMetadata } from '#shared/agent/agent.schema'; // Assuming FileMetadata is in agent.schema
import { BaseSpecPo } from '../../../../../test/base.po';
import type { AgentToolStateComponent } from './agent-tool-state.component';

export class AgentToolStatePo extends BaseSpecPo<AgentToolStateComponent> {
	private ids = {
		loadingSpinner: 'loading-spinner',
		liveFilesSection: 'live-files-section',
		noLiveFilesMessage: 'no-live-files-message',
		liveFilesList: 'live-files-list',
		fileStoreSection: 'file-store-section',
		noFileStoreEntriesMessage: 'no-file-store-entries-message',
		fileStoreTable: 'file-store-table',
	} as const;

	async isLoading(): Promise<boolean> {
		const spinnerHarness = await this.loader.getHarnessOrNull(MatProgressSpinnerHarness.with({ selector: `[data-testid="${this.ids.loadingSpinner}"]` }));
		return !!spinnerHarness;
	}

	async getLiveFileItems(): Promise<TestElement[]> {
		// Ensure the list itself exists before querying items within it
		if (await this.has(this.ids.liveFilesList)) {
			return this.els(this.ids.liveFilesList)[0].queryAll(() => true); // queryAll(By.css('li'))
		}
		return [];
	}

	async getLiveFileTexts(): Promise<string[]> {
		const items = await this.getLiveFileItems();
		return Promise.all(items.map(async (item) => (await item.text()).trim()));
	}

	async hasNoLiveFilesMessage(): Promise<boolean> {
		return this.has(this.ids.noLiveFilesMessage);
	}

	async getNoLiveFilesMessageText(): Promise<string | null> {
		if (await this.hasNoLiveFilesMessage()) {
			return this.text(this.ids.noLiveFilesMessage);
		}
		return null;
	}

	async hasFileStoreTable(): Promise<boolean> {
		return this.has(this.ids.fileStoreTable);
	}

	private async getFileStoreTableHarness(): Promise<MatTableHarness | null> {
		return this.loader.getHarnessOrNull(MatTableHarness.with({ selector: `[data-testid="${this.ids.fileStoreTable}"]` }));
	}

	async getFileStoreTableHeaders(): Promise<string[]> {
		const table = await this.getFileStoreTableHarness();
		if (!table) return [];
		const headerRows = await table.getHeaderRows();
		if (headerRows.length === 0) return [];
		return headerRows[0].getCellTextByColumnName();
	}

	async getFileStoreTableRows(): Promise<MatRowHarness[]> {
		const table = await this.getFileStoreTableHarness();
		return table ? table.getRows() : [];
	}

	async getFileStoreTableRowsAsText(): Promise<string[][]> {
		const rows = await this.getFileStoreTableRows();
		return Promise.all(rows.map(async (row) => row.getCellTextByIndex()));
	}

	async hasNoFileStoreEntriesMessage(): Promise<boolean> {
		return this.has(this.ids.noFileStoreEntriesMessage);
	}

	async getNoFileStoreEntriesMessageText(): Promise<string | null> {
		if (await this.hasNoFileStoreEntriesMessage()) {
			return this.text(this.ids.noFileStoreEntriesMessage);
		}
		return null;
	}

	async setAgentDetails(agentDetails?: AgentContextApi): Promise<void> {
		this.fix.componentRef.setInput('agentDetails', agentDetails);
		await this.detectAndWait();
	}
}
