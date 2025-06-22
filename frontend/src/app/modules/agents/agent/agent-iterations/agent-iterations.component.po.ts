import { ComponentFixture } from '@angular/core/testing';
import { MatExpansionPanelHarness } from '@angular/material/expansion/testing';
import { By } from '@angular/platform-browser';
import { BaseSpecPo } from '../../../../../test/base.po';
import { AgentIterationsComponent } from './agent-iterations.component';

export class AgentIterationsPo extends BaseSpecPo<AgentIterationsComponent> {
	private readonly ids = {
		loadingSpinner: 'loading-spinner',
		errorMessage: 'error-message',
		iterationsAccordion: 'iterations-accordion',
		noIterationsMessage: 'no-iterations-message',
		iterationPanelPrefix: 'iteration-panel-',
		iterationHeaderPrefix: 'iteration-header-', // Note: Header itself might not have a testid, panel is used for interaction
		iterationSummaryPrefix: 'iteration-summary-',
		iterationDetailLoadingPrefix: 'iteration-detail-loading-',
		iterationDetailErrorPrefix: 'iteration-detail-error-',
		iterationDetailSuccessPrefix: 'iteration-detail-success-',
		iterationPromptContentPrefix: 'iteration-prompt-content-',
		iterationPlanContentPrefix: 'iteration-plan-content-',
		iterationCodeContentPrefix: 'iteration-code-content-',
		iterationFunctionCallsContentPrefix: 'iteration-function-calls-content-',
		functionCallItemPrefix: (iteration: number) => `function-call-${iteration}-`,
		functionCallErrorPrefix: (iteration: number, callIndex: number) => `function-call-error-${iteration}-${callIndex}`,
		iterationMemoryContentPrefix: 'iteration-memory-content-',
		iterationToolStateContentPrefix: 'iteration-tool-state-content-',
	} as const;

	// Helper to construct dynamic test IDs
	private getTestId(prefix: string, iteration: number, suffix?: number | string): string {
		return suffix !== undefined ? `${prefix}${iteration}-${suffix}` : `${prefix}${iteration}`;
	}

	async isOverallLoading(): Promise<boolean> {
		return this.has(this.ids.loadingSpinner);
	}

	async getOverallError(): Promise<string | null> {
		return this.textOrNull(this.ids.errorMessage);
	}

	async isNoIterationsMessageDisplayed(): Promise<boolean> {
		return this.has(this.ids.noIterationsMessage);
	}

	async getNoIterationsMessageText(): Promise<string | null> {
		return this.textOrNull(this.ids.noIterationsMessage);
	}

	async getIterationCount(): Promise<number> {
		const panelElements = this.fix.debugElement.queryAll(By.css(`[data-testid^="${this.ids.iterationPanelPrefix}"]`));
		return panelElements.length;
	}

	async getIterationPanelSummaries(): Promise<{ iteration: number; summary: string }[]> {
		const summaryElements = this.fix.debugElement.queryAll(By.css(`[data-testid^="${this.ids.iterationSummaryPrefix}"]`));
		const results = [];
		for (const el of summaryElements) {
			const testId = el.attributes['data-testid'] ?? '';
			const iteration = Number.parseInt(testId.replace(this.ids.iterationSummaryPrefix, ''), 10);
			let fullTitle = (el.nativeElement.textContent || '').trim();
			// The summary is part of the panel title, e.g., "Iteration #1 Test iteration 1 summary"
			// We extract the summary part after "Iteration #X "
			const iterationPrefix = `Iteration #${iteration}`;
			if (fullTitle.startsWith(iterationPrefix)) {
				fullTitle = fullTitle.substring(iterationPrefix.length).trim();
			}
			results.push({ iteration, summary: fullTitle });
		}
		return results.sort((a, b) => a.iteration - b.iteration);
	}

	async expandIterationPanel(iteration: number): Promise<void> {
		const panelTestId = this.getTestId(this.ids.iterationPanelPrefix, iteration);
		const panelHarness = await this.loader.getHarness(MatExpansionPanelHarness.with({ selector: `[data-testid="${panelTestId}"]` }));
		if (!(await panelHarness.isExpanded())) {
			await panelHarness.expand();
		}
		// ensure content is loaded/rendered after expansion, which might trigger async operations
		await this.detectAndWait();
	}

	async isIterationDetailLoading(iteration: number): Promise<boolean> {
		return this.has(this.getTestId(this.ids.iterationDetailLoadingPrefix, iteration));
	}

	async getIterationDetailError(iteration: number): Promise<string | null> {
		return this.textOrNull(this.getTestId(this.ids.iterationDetailErrorPrefix, iteration));
	}

	async isIterationDetailDisplayed(iteration: number): Promise<boolean> {
		return this.has(this.getTestId(this.ids.iterationDetailSuccessPrefix, iteration));
	}

	async getIterationPrompt(iteration: number): Promise<string | null> {
		return this.textOrNull(this.getTestId(this.ids.iterationPromptContentPrefix, iteration));
	}

	async getIterationPlan(iteration: number): Promise<string | null> {
		return this.textOrNull(this.getTestId(this.ids.iterationPlanContentPrefix, iteration));
	}

	async getIterationCode(iteration: number): Promise<string | null> {
		return this.textOrNull(this.getTestId(this.ids.iterationCodeContentPrefix, iteration));
	}

	async getFunctionCallCount(iteration: number): Promise<number> {
		const callItems = this.fix.debugElement.queryAll(By.css(`[data-testid^="${this.ids.functionCallItemPrefix(iteration)}"]`));
		return callItems.length;
	}

	async hasFunctionCallError(iteration: number, callIndex: number): Promise<boolean> {
		return this.has(this.ids.functionCallErrorPrefix(iteration, callIndex));
	}

	// This helper is useful for optional elements.
	protected async textOrNull(id: string): Promise<string | null> {
		if (await this.has(id)) {
			return this.text(id);
		}
		return null;
	}

	// Static create method is inherited from BaseSpecPo.
}
