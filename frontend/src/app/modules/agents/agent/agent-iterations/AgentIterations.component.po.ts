import { HarnessLoader } from '@angular/cdk/testing';
import { TestElement } from '@angular/cdk/testing';
import { ComponentFixture } from '@angular/core/testing';
import { MatAccordionHarness, MatExpansionPanelHarness } from '@angular/material/expansion/testing';
import { BaseSpecPo } from '../../../../../test/base.po';
import { AgentIterationsComponent } from './AgentIterations.component';

export class AgentIterationsPo extends BaseSpecPo<AgentIterationsComponent> {
	protected ids = {
		iterationAccordion: 'iteration-accordion',
		noIterationsMessage: 'no-iterations-message',
		// Individual panel titles or LLM call sections will be accessed via harnesses or constructed test IDs.
		llmCallSectionPrefix: 'llm-call-section-',
	} as const;

	async getAccordionHarness(): Promise<MatAccordionHarness | null> {
		try {
			return await this.loader.getHarness(MatAccordionHarness.with({ selector: `[data-testid="${this.ids.iterationAccordion}"]` }));
		} catch {
			return null;
		}
	}

	async getAllExpansionPanelHarnesses(accordion?: MatAccordionHarness | null): Promise<MatExpansionPanelHarness[]> {
		const targetAccordion = accordion ?? (await this.getAccordionHarness());
		if (!targetAccordion) {
			return [];
		}
		return targetAccordion.getExpansionPanels();
	}

	async isNoIterationsMessageDisplayed(): Promise<boolean> {
		return this.has(this.ids.noIterationsMessage);
	}

	async getPanelTitle(panel: MatExpansionPanelHarness): Promise<string | null> {
		return panel.getTitle();
	}

	async getPanelDescription(panel: MatExpansionPanelHarness): Promise<string | null> {
		return panel.getDescription();
	}

	async expandPanel(panel: MatExpansionPanelHarness): Promise<void> {
		if (!(await panel.isExpanded())) {
			await panel.expand();
		}
	}

	async collapsePanel(panel: MatExpansionPanelHarness): Promise<void> {
		if (await panel.isExpanded()) {
			await panel.collapse();
		}
	}

	async isPanelExpanded(panel: MatExpansionPanelHarness): Promise<boolean> {
		return panel.isExpanded();
	}

	async getLlmCallContentInSection(panel: MatExpansionPanelHarness, llmCallId: string): Promise<string | null> {
		const contentLoader = await panel.getHarnessLoaderForContent();
		const hostElement = await contentLoader.hostElement();
		const llmCallTestId = `${this.ids.llmCallSectionPrefix}${llmCallId}`;

		try {
			// Query for the specific data-testid within the panel's content
			const targetElement: TestElement | null = await hostElement.child(`[data-testid="${llmCallTestId}"] pre`);
			if (targetElement) {
				return await targetElement.text();
			}
		} catch (e) {
			// Element not found
			return null;
		}
		return null;
	}

	// The static create method is inherited from BaseSpecPo
}
