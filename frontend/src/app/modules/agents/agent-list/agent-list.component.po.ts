import type { TestElement } from '@angular/cdk/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatProgressBarHarness } from '@angular/material/progress-bar/testing';
import { By } from '@angular/platform-browser';
import { BaseSpecPo } from '../../../../test/base.po';
import type { AgentListComponent } from './agent-list.component';

export class AgentListPo extends BaseSpecPo<AgentListComponent> {
	protected override readonly fix: ComponentFixture<AgentListComponent>;

	private readonly ids = {
		searchInput: 'agent-search-input',
		refreshButton: 'refresh-agents-button',
		createAgentButton: 'create-agent-button',
		deleteSelectedButton: 'delete-selected-agents-button',
		loadingBar: 'loading-bar',
		masterToggleCheckbox: 'master-toggle-checkbox',
		agentRow: (agentId: string) => `agent-row-${agentId}`,
		agentCheckbox: (agentId: string) => `agent-checkbox-${agentId}`,
		agentNameLink: (agentId: string) => `agent-name-link-${agentId}`,
		agentStateDisplay: (agentId: string) => `agent-state-${agentId}`,
		agentTypeDisplay: (agentId: string) => `agent-type-${agentId}`,
		agentCostDisplay: (agentId: string) => `agent-cost-${agentId}`,
		noAgentsMessage: 'no-agents-message',
		errorMessageDisplay: 'error-display', // General error display area
	} as const;

	constructor(fixture: ComponentFixture<AgentListComponent>) {
		super(fixture);
		this.fix = fixture;
	}

	// --- State Query Methods ---

	async isLoading(): Promise<boolean> {
		// Check if the progress bar harness exists
		const progressBarHarnesses = await this.loader.getAllHarnesses(MatProgressBarHarness.with({ selector: `[data-testid="${this.ids.loadingBar}"]` }));
		return progressBarHarnesses.length > 0;
	}

	async getSearchInputValue(): Promise<string> {
		return (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.searchInput}"]` })).getValue();
	}

	async isMasterToggleChecked(): Promise<boolean> {
		return (await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.masterToggleCheckbox}"]` })).isChecked();
	}

	async isAgentRowCheckboxChecked(agentId: string): Promise<boolean> {
		const selector = `[data-testid="${this.ids.agentCheckbox(agentId)}"]`;
		// Ensure the element exists before trying to get a harness for it
		if (this.els(this.ids.agentCheckbox(agentId)).length === 0) {
			// console.warn(`Checkbox for agent ${agentId} not found.`);
			return false; // Or throw an error if appropriate for the test context
		}
		return (await this.harness(MatCheckboxHarness, { selector })).isChecked();
	}

	async getAgentName(agentId: string): Promise<string> {
		return this.text(this.ids.agentNameLink(agentId));
	}

	async getAgentState(agentId: string): Promise<string> {
		return this.text(this.ids.agentStateDisplay(agentId));
	}

	async getAgentType(agentId: string): Promise<string> {
		return this.text(this.ids.agentTypeDisplay(agentId));
	}

	async getAgentCost(agentId: string): Promise<string> {
		return this.text(this.ids.agentCostDisplay(agentId));
	}

	async getDisplayedAgentIds(): Promise<string[]> {
		const rows = this.fix.debugElement.queryAll(By.css('[data-testid^="agent-row-"]'));
		return rows.map((row) => row.attributes['data-testid']?.replace('agent-row-', '')).filter(Boolean) as string[];
	}

	async getSelectedAgentIds(): Promise<string[]> {
		const selectedIds: string[] = [];
		const agentRows = await this.getDisplayedAgentIds(); // Get IDs of all currently displayed agents

		for (const agentId of agentRows) {
			if (await this.isAgentRowCheckboxChecked(agentId)) {
				selectedIds.push(agentId);
			}
		}
		return selectedIds;
	}

	async getNoAgentsMessageText(): Promise<string | null> {
		if (this.has(this.ids.noAgentsMessage)) {
			return this.text(this.ids.noAgentsMessage);
		}
		return null;
	}

	async getErrorMessageText(): Promise<string | null> {
		if (this.has(this.ids.errorMessageDisplay)) {
			return this.text(this.ids.errorMessageDisplay);
		}
		return null;
	}

	// --- User Action Methods ---

	async typeInSearchInput(text: string): Promise<void> {
		await (await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.searchInput}"]` })).setValue(text);
		// Debounce is handled in the component, test should tick or wait
		await this.detectAndWait();
	}

	// For tests that need to control debounce timing with fakeAsync
	async typeInSearchInputWithoutWait(text: string): Promise<void> {
		const inputHarness = await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.searchInput}"]` });
		await inputHarness.setValue(text);
		// No detectAndWait here, caller should handle fixture.detectChanges() and tick()
	}

	async clickRefreshButton(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.refreshButton}"]` })).click();
		await this.detectAndWait();
	}

	async clickCreateAgentButton(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.createAgentButton}"]` })).click();
		await this.detectAndWait();
	}

	async clickDeleteSelectedAgentsButton(): Promise<void> {
		await (await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.deleteSelectedButton}"]` })).click();
		await this.detectAndWait();
	}

	async clickMasterToggle(): Promise<void> {
		await (await this.harness(MatCheckboxHarness, { selector: `[data-testid="${this.ids.masterToggleCheckbox}"]` })).toggle();
		await this.detectAndWait();
	}

	async clickAgentRowCheckbox(agentId: string): Promise<void> {
		const selector = `[data-testid="${this.ids.agentCheckbox(agentId)}"]`;
		await (await this.harness(MatCheckboxHarness, { selector })).toggle();
		await this.detectAndWait();
	}

	async clickAgentNameLink(agentId: string): Promise<void> {
		await this.click(this.ids.agentNameLink(agentId)); // BaseSpecPo click handles detectAndWait
	}

	// Helper for waiting for debounce, if tests are async
	async waitForDebounce(milliseconds: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, milliseconds));
	}
}
