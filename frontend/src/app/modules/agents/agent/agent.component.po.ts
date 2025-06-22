import { ComponentFixture } from '@angular/core/testing';
import { MatTabGroupHarness, MatTabHarness } from '@angular/material/tabs/testing';
import { BaseSpecPo } from '../../../../test/base.po';
import type { AgentComponent } from './agent.component';

export class AgentPo extends BaseSpecPo<AgentComponent> {
	private readonly ids = {
		tabGroup: 'agent-tabs', // Assuming this data-testid exists on mat-tab-group
	} as const;

	private async getTabGroupHarness(): Promise<MatTabGroupHarness> {
		return this.loader.getHarness(MatTabGroupHarness.with({ selector: `[data-testid="${this.ids.tabGroup}"]` }));
	}

	async getSelectedTabLabel(): Promise<string | null> {
		const tabGroup = await this.getTabGroupHarness();
		const selectedTab = await tabGroup.getSelectedTab();
		return selectedTab.getLabel();
	}

	async selectTabByLabel(label: string): Promise<void> {
		const tabGroup = await this.getTabGroupHarness();
		await tabGroup.selectTab({ label });
		await this.detectAndWait();
	}

	async getAllTabLabels(): Promise<string[]> {
		const tabGroup = await this.getTabGroupHarness();
		const tabs = await tabGroup.getTabs();
		return Promise.all(tabs.map((tab) => tab.getLabel()));
	}

	// Static create method is inherited from BaseSpecPo
	// static async create(fixture: ComponentFixture<AgentComponent>): Promise<AgentPo> {
	//  fixture.detectChanges();
	//  await fixture.whenStable();
	//  fixture.detectChanges();
	//  return new AgentPo(fixture);
	//}
}
