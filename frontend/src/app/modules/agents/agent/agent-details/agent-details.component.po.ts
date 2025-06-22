import { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatExpansionPanelHarness } from '@angular/material/expansion/testing';
import { MatInputHarness } from '@angular/material/input/testing';

import { BaseSpecPo } from '../../../../../test/base.po';
import { AgentDetailsComponent } from './agent-details.component';

export class AgentDetailsPo extends BaseSpecPo<AgentDetailsComponent> {
	private ids = {
		feedbackInput: 'feedback-input',
		submitFeedbackButton: 'submit-feedback-btn',
		hilFeedbackInput: 'hil-feedback-input',
		resumeHilButton: 'resume-hil-btn',
		errorDetailsInput: 'error-details-input',
		resumeErrorButton: 'resume-error-btn',
		cancelAgentButton: 'cancel-agent-btn',
		forceStopButton: 'force-stop-agent-btn',
		requestHilButton: 'request-hil-btn',
		editFunctionsButton: 'edit-functions-btn',
		resumeCompletedButton: 'resume-completed-btn',
		agentNameDisplay: 'agent-name-display',
		agentStateDisplay: 'agent-state-display',
		userPromptDisplay: 'user-prompt-display',
		outputExpansionPanel: 'output-expansion-panel',
		agentOutputContent: 'agent-output-content',
		traceUrlLink: 'trace-url-link',
		logsUrlLink: 'logs-url-link',
		databaseUrlLink: 'database-url-link',
		llmEasyDisplay: 'llm-easy-display',
		llmMediumDisplay: 'llm-medium-display',
		llmHardDisplay: 'llm-hard-display',
	} as const;

	// State Queries
	async getFeedbackInputValue(): Promise<string> {
		return this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.feedbackInput}"]` }).then((h) => h.getValue());
	}

	async getHilFeedbackInputValue(): Promise<string> {
		return this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.hilFeedbackInput}"]` }).then((h) => h.getValue());
	}

	async getErrorDetailsInputValue(): Promise<string> {
		return this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.errorDetailsInput}"]` }).then((h) => h.getValue());
	}

	async isSubmitFeedbackButtonEnabled(): Promise<boolean> {
		return this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.submitFeedbackButton}"]` }).then((h) => h.isDisabled().then((d) => !d));
	}

	async isResumeHilButtonEnabled(): Promise<boolean> {
		return this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.resumeHilButton}"]` }).then((h) => h.isDisabled().then((d) => !d));
	}

	async isResumeErrorButtonEnabled(): Promise<boolean> {
		return this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.resumeErrorButton}"]` }).then((h) => h.isDisabled().then((d) => !d));
	}

	async isForceStopButtonVisible(): Promise<boolean> {
		return this.has(this.ids.forceStopButton);
	}

	async isRequestHilButtonEnabled(): Promise<boolean> {
		// Assuming the button might be disabled or not present
		if (!(await this.has(this.ids.requestHilButton))) return false;
		return this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.requestHilButton}"]` }).then((h) => h.isDisabled().then((d) => !d));
	}

	async getAgentNameText(): Promise<string> {
		return this.text(this.ids.agentNameDisplay);
	}

	async getAgentStateText(): Promise<string> {
		return this.text(this.ids.agentStateDisplay);
	}

	async getUserPromptText(): Promise<string> {
		return this.text(this.ids.userPromptDisplay);
	}

	async getOutputText(): Promise<string> {
		if (!(await this.isOutputExpanded())) {
			await this.toggleOutputExpansion();
		}
		return this.text(this.ids.agentOutputContent);
	}

	async isOutputExpanded(): Promise<boolean> {
		return this.harness(MatExpansionPanelHarness, { selector: `[data-testid="${this.ids.outputExpansionPanel}"]` }).then((h) => h.isExpanded());
	}

	async getTraceUrl(): Promise<string | null> {
		return this.getAttribute(this.ids.traceUrlLink, 'href');
	}

	async getLogsUrl(): Promise<string | null> {
		return this.getAttribute(this.ids.logsUrlLink, 'href');
	}

	async getDatabaseUrl(): Promise<string | null> {
		return this.getAttribute(this.ids.databaseUrlLink, 'href');
	}

	async getLlmEasyName(): Promise<string> {
		return this.text(this.ids.llmEasyDisplay);
	}
	async getLlmMediumName(): Promise<string> {
		return this.text(this.ids.llmMediumDisplay);
	}
	async getLlmHardName(): Promise<string> {
		return this.text(this.ids.llmHardDisplay);
	}

	// User Actions
	async typeFeedback(text: string): Promise<void> {
		await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.feedbackInput}"]` }).then((h) => h.setValue(text));
		await this.detectAndWait();
	}

	async clickSubmitFeedback(): Promise<void> {
		await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.submitFeedbackButton}"]` }).then((h) => h.click());
		await this.detectAndWait();
	}

	async typeHilFeedback(text: string): Promise<void> {
		await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.hilFeedbackInput}"]` }).then((h) => h.setValue(text));
		await this.detectAndWait();
	}

	async clickResumeHil(): Promise<void> {
		await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.resumeHilButton}"]` }).then((h) => h.click());
		await this.detectAndWait();
	}

	async typeErrorDetails(text: string): Promise<void> {
		await this.harness(MatInputHarness, { selector: `[data-testid="${this.ids.errorDetailsInput}"]` }).then((h) => h.setValue(text));
		await this.detectAndWait();
	}

	async clickResumeError(): Promise<void> {
		await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.resumeErrorButton}"]` }).then((h) => h.click());
		await this.detectAndWait();
	}

	async clickCancelAgent(): Promise<void> {
		await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.cancelAgentButton}"]` }).then((h) => h.click());
		await this.detectAndWait();
	}

	async clickForceStopAgent(): Promise<void> {
		await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.forceStopButton}"]` }).then((h) => h.click());
		await this.detectAndWait();
	}

	async clickRequestHil(): Promise<void> {
		await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.requestHilButton}"]` }).then((h) => h.click());
		await this.detectAndWait();
	}

	async clickEditFunctions(): Promise<void> {
		await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.editFunctionsButton}"]` }).then((h) => h.click());
		await this.detectAndWait();
	}

	async clickResumeCompleted(): Promise<void> {
		await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.resumeCompletedButton}"]` }).then((h) => h.click());
		await this.detectAndWait();
	}

	async toggleOutputExpansion(): Promise<void> {
		const panel = await this.harness(MatExpansionPanelHarness, { selector: `[data-testid="${this.ids.outputExpansionPanel}"]` });
		if (await panel.isExpanded()) {
			await panel.collapse();
		} else {
			await panel.expand();
		}
		await this.detectAndWait();
	}
}
