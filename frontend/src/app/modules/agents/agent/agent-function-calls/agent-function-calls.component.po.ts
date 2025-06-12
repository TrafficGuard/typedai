import { DebugElement } from '@angular/core';
import { MatExpansionPanelHarness } from '@angular/material/expansion/testing';
import { By } from '@angular/platform-browser';

import { BaseSpecPo } from '../../../../../test/base.po';
import { AgentFunctionCallsComponent } from './agent-function-calls.component';

export class AgentFunctionCallsPo extends BaseSpecPo<AgentFunctionCallsComponent> {
	public async getFunctionCallItems(): Promise<DebugElement[]> {
		return this.fix.debugElement.queryAll(By.css('mat-card > div.pb-8'));
	}

	public async getFunctionName(funcCallItemDebugEl: DebugElement): Promise<string> {
		const nameEl = funcCallItemDebugEl.query(By.css('div.mb-3.font-medium.text-xl'));
		return nameEl?.nativeElement.textContent?.trim() ?? '';
	}

	public async getParameterItems(funcCallItemDebugEl: DebugElement): Promise<DebugElement[]> {
		// Selects div elements that are direct children of funcCallItemDebugEl and contain a <strong> element,
		// which are characteristic of parameter items.
		return funcCallItemDebugEl.queryAll(By.css('div:has(> strong)'));
	}

	public async getParameterKey(paramItemDebugEl: DebugElement): Promise<string> {
		const strongEl = paramItemDebugEl.query(By.css('strong'));
		return strongEl?.nativeElement.textContent?.trim().replace(':', '') ?? '';
	}

	private async getParameterExpansionPanel(paramItemDebugEl: DebugElement): Promise<MatExpansionPanelHarness | null> {
		const panelNativeElement = paramItemDebugEl.query(By.css('mat-expansion-panel'))?.nativeElement;
		if (!panelNativeElement) return null;

		const allPanelsOnPage = await this.loader.getAllHarnesses(MatExpansionPanelHarness);
		for (const panel of allPanelsOnPage) {
			if ((await panel.host()).nativeElement === panelNativeElement) {
				return panel;
			}
		}
		return null;
	}

	public async getParameterValue(paramItemDebugEl: DebugElement): Promise<string> {
		const panelHarness = await this.getParameterExpansionPanel(paramItemDebugEl);
		if (panelHarness) {
			if (!(await panelHarness.isExpanded())) {
				await panelHarness.expand();
				await this.detectAndWait();
			}
			return panelHarness.getTextContent();
		}
		const keyText = (await this.getParameterKey(paramItemDebugEl)).trim();
		const fullText = paramItemDebugEl.nativeElement.textContent?.trim() ?? '';
		// Add 1 for the colon and potentially a space
		return fullText.substring(keyText.length + 1).trim();
	}

	public async getParameterValueShort(paramItemDebugEl: DebugElement): Promise<string | null> {
		const panelHarness = await this.getParameterExpansionPanel(paramItemDebugEl);
		if (panelHarness) {
			if (await panelHarness.isExpanded()) return null; // Short text not visible if expanded
			return panelHarness.getTitle();
		}
		const keyText = (await this.getParameterKey(paramItemDebugEl)).trim();
		const fullText = paramItemDebugEl.nativeElement.textContent?.trim() ?? '';
		return fullText.substring(keyText.length + 1).trim();
	}

	public async isParameterLong(paramItemDebugEl: DebugElement): Promise<boolean> {
		return !!paramItemDebugEl.query(By.css('mat-expansion-panel'));
	}

	public async getStdoutPanel(funcCallItemDebugEl: DebugElement): Promise<MatExpansionPanelHarness | null> {
		const allPanelsOnPage = await this.loader.getAllHarnesses(MatExpansionPanelHarness);
		for (const panel of allPanelsOnPage) {
			const host = await panel.host();
			if (funcCallItemDebugEl.nativeElement.contains(await host.getNativeElement()) && (await panel.getTitle()) === 'Output') {
				return panel;
			}
		}
		return null;
	}

	public async getStderrPanel(funcCallItemDebugEl: DebugElement): Promise<MatExpansionPanelHarness | null> {
		const allPanelsOnPage = await this.loader.getAllHarnesses(MatExpansionPanelHarness);
		for (const panel of allPanelsOnPage) {
			const host = await panel.host();
			if (funcCallItemDebugEl.nativeElement.contains(await host.getNativeElement()) && (await panel.getTitle()) === 'Errors') {
				return panel;
			}
		}
		return null;
	}

	public async getPanelContent(panel: MatExpansionPanelHarness): Promise<string> {
		if (!(await panel.isExpanded())) {
			await panel.expand();
			await this.detectAndWait();
		}
		return panel.getTextContent();
	}

	public async expandPanel(panel: MatExpansionPanelHarness): Promise<void> {
		if (!(await panel.isExpanded())) {
			await panel.expand();
			await this.detectAndWait();
		}
	}
}
