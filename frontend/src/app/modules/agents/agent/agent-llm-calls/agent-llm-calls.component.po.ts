import { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatExpansionPanelHarness } from '@angular/material/expansion/testing';
import { MatProgressSpinnerHarness } from '@angular/material/progress-spinner/testing';
import { By } from '@angular/platform-browser';
import { BaseSpecPo } from '../../../../../test/base.po';
import { AgentLlmCallsComponent } from './agent-llm-calls.component';

export class AgentLlmCallsPo extends BaseSpecPo<AgentLlmCallsComponent> {
	private readonly ids = {
		loadingSpinner: 'loading-spinner',
		errorMessage: 'error-message',
		noCallsMessage: 'no-calls-message',
		llmCallList: 'llm-call-list',
		llmCallPanelPrefix: 'llm-call-panel-',
		llmCallPanelTitlePrefix: 'llm-call-panel-title-',
		llmCallDetailLoadingPrefix: 'llm-call-detail-loading-',
		llmCallDetailErrorPrefix: 'llm-call-detail-error-',
		promptStudioButtonPrefix: 'prompt-studio-button-',
		llmCallUrlPrefix: 'llm-call-url-',
		copyRawResponseButtonPrefix: 'copy-raw-response-button-',
		copyRenderedResponseButtonPrefix: 'copy-rendered-response-button-',
		llmCallMessageRolePrefix: 'llm-call-message-role-',
		llmCallMessageContentPrefix: 'llm-call-message-content-',
	} as const;

	// --- State Queries ---
	async isLoading(): Promise<boolean> {
		return this.loader.hasHarness(MatProgressSpinnerHarness.with({ selector: `[data-testid="${this.ids.loadingSpinner}"]` }));
	}

	async isErrorDisplayed(): Promise<boolean> {
		return this.has(this.ids.errorMessage);
	}

	async getErrorMessage(): Promise<string | null> {
		if (await this.isErrorDisplayed()) {
			return this.text(this.ids.errorMessage);
		}
		return null;
	}

	async isNoCallsMessageDisplayed(): Promise<boolean> {
		return this.has(this.ids.noCallsMessage);
	}

	async getLlmCallPanelCount(): Promise<number> {
		const panels = await this.loader.getAllHarnesses(MatExpansionPanelHarness.with({ ancestor: `[data-testid="${this.ids.llmCallList}"]` }));
		return panels.length;
	}

	async getLlmCallPanel(index: number): Promise<MatExpansionPanelHarness | null> {
		try {
			return await this.loader.getHarness(MatExpansionPanelHarness.with({ selector: `[data-testid="${this.ids.llmCallPanelPrefix}${index}"]` }));
		} catch {
			return null;
		}
	}

	async isLlmCallPanelExpanded(index: number): Promise<boolean> {
		const panel = await this.getLlmCallPanel(index);
		return panel ? panel.isExpanded() : false;
	}

	async getLlmCallPanelTitle(index: number): Promise<string | null> {
		const panel = await this.getLlmCallPanel(index);
		if (!panel) return null;
		// Assuming title is within a specific element in the header or directly as header text
		// For this example, let's assume a data-testid for the title span
		const titleElement = this.fix.debugElement.query(By.css(`[data-testid="${this.ids.llmCallPanelTitlePrefix}${index}"]`));
		return titleElement ? titleElement.nativeElement.textContent.trim() : null;
	}

	async isLlmCallDetailLoading(panelIndex: number): Promise<boolean> {
		const panel = await this.getLlmCallPanel(panelIndex);
		if (!panel || !(await panel.isExpanded())) return false;
		return this.loader.hasHarness(MatProgressSpinnerHarness.with({ selector: `[data-testid="${this.ids.llmCallDetailLoadingPrefix}${panelIndex}"]` }));
	}

	async isLlmCallDetailErrorDisplayed(panelIndex: number): Promise<boolean> {
		const panel = await this.getLlmCallPanel(panelIndex);
		if (!panel || !(await panel.isExpanded())) return false;
		return this.has(`${this.ids.llmCallDetailErrorPrefix}${panelIndex}`);
	}

	async getLlmCallDetailErrorMessage(panelIndex: number): Promise<string | null> {
		if (await this.isLlmCallDetailErrorDisplayed(panelIndex)) {
			return this.text(`${this.ids.llmCallDetailErrorPrefix}${panelIndex}`);
		}
		return null;
	}

	async getLlmCallMessageRole(panelIndex: number, messageIndex: number): Promise<string | null> {
		const panel = await this.getLlmCallPanel(panelIndex);
		if (!panel || !(await panel.isExpanded())) return null;
		return this.text(`${this.ids.llmCallMessageRolePrefix}${panelIndex}-${messageIndex}`);
	}

	async getLlmCallMessageContent(panelIndex: number, messageIndex: number): Promise<string | null> {
		const panel = await this.getLlmCallPanel(panelIndex);
		if (!panel || !(await panel.isExpanded())) return null;
		// Content might be HTML, so textContent might be simplified
		const el = this.el(`${this.ids.llmCallMessageContentPrefix}${panelIndex}-${messageIndex}`);
		return el.nativeElement.innerHTML; // Or .textContent if plain text is expected
	}

	// --- User Actions ---
	async expandLlmCallPanel(index: number): Promise<void> {
		const panel = await this.getLlmCallPanel(index);
		if (panel && !(await panel.isExpanded())) {
			await panel.expand();
			await this.detectAndWait();
		}
	}

	async collapseLlmCallPanel(index: number): Promise<void> {
		const panel = await this.getLlmCallPanel(index);
		if (panel && (await panel.isExpanded())) {
			await panel.collapse();
			await this.detectAndWait();
		}
	}

	async clickPromptStudioButton(panelIndex: number): Promise<void> {
		const panel = await this.getLlmCallPanel(panelIndex);
		if (!panel || !(await panel.isExpanded())) throw new Error(`Panel ${panelIndex} not expanded or not found.`);
		const button = await this.loader.getHarness(MatButtonHarness.with({ selector: `[data-testid="${this.ids.promptStudioButtonPrefix}${panelIndex}"]` }));
		await button.click();
		await this.detectAndWait();
	}

	async clickLlmCallUrl(panelIndex: number): Promise<void> {
		const panel = await this.getLlmCallPanel(panelIndex);
		if (!panel || !(await panel.isExpanded())) throw new Error(`Panel ${panelIndex} not expanded or not found.`);
		// Assuming the URL is an <a> tag
		await this.click(`${this.ids.llmCallUrlPrefix}${panelIndex}`);
	}

	async clickCopyRawResponseButton(panelIndex: number): Promise<void> {
		const panel = await this.getLlmCallPanel(panelIndex);
		if (!panel || !(await panel.isExpanded())) throw new Error(`Panel ${panelIndex} not expanded or not found.`);
		// Assuming ClipboardButtonComponent renders a button that can be targeted
		// This might need adjustment based on ClipboardButtonComponent's actual template
		const button = await this.loader.getHarness(
			MatButtonHarness.with({ selector: `[data-testid="${this.ids.copyRawResponseButtonPrefix}${panelIndex}"] button` }),
		); // or just the selector for ClipboardButtonComponent if it's not a mat-button
		await button.click();
		await this.detectAndWait();
	}

	async clickCopyRenderedResponseButton(panelIndex: number): Promise<void> {
		const panel = await this.getLlmCallPanel(panelIndex);
		if (!panel || !(await panel.isExpanded())) throw new Error(`Panel ${panelIndex} not expanded or not found.`);
		const button = await this.loader.getHarness(
			MatButtonHarness.with({ selector: `[data-testid="${this.ids.copyRenderedResponseButtonPrefix}${panelIndex}"] button` }),
		);
		await button.click();
		await this.detectAndWait();
	}

	// Static create method is inherited from BaseSpecPo
}
