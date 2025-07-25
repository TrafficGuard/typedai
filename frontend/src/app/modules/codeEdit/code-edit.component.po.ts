import { By } from '@angular/platform-browser';
import { ComponentFixture } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { CodeEditComponent } from './code-edit.component';
import { BaseSpecPo } from 'test/base.po';


export class CodeEditPo extends BaseSpecPo<CodeEditComponent> {
	protected loader: HarnessLoader;

	private readonly ids = {
		fileTreeSpinner: 'file-tree-spinner',
		fileTreeError: 'file-tree-error',
		fileTreeRetryButton: 'file-tree-retry-button',
		nodeCheckbox: (path: string) => `node-checkbox-${path}`,
		selectionCount: 'selection-count',
		selectionRow: (path: string) => `selection-row-${path}`,
		removeFileButton: (path: string) => `remove-file-button-${path}`,
		instructionsTextarea: 'instructions-textarea',
		submissionError: 'submission-error',
		submitButton: 'submit-button',
		submitSpinner: 'submit-spinner',
	} as const;

	constructor(fixture: ComponentFixture<CodeEditComponent>) {
		super(fixture);
		this.loader = TestbedHarnessEnvironment.loader(this.fix);
	}

	static async create(fixture: ComponentFixture<CodeEditComponent>): Promise<CodeEditPo> {
		const po = new CodeEditPo(fixture);
		await po.detectAndWait();
		return po;
	}

	// --- State Queries ---

	private findAll(idPrefix: string) {
		return this.fix.debugElement.queryAll(By.css(`[data-testid^="${idPrefix}"]`));
	}

	async isLoadingFileTree(): Promise<boolean> {
		return this.has(this.ids.fileTreeSpinner);
	}

	async getFileTreeError(): Promise<string | null> {
		return this.has(this.ids.fileTreeError) ? this.text(this.ids.fileTreeError) : null;
	}

	async isNodeSelected(path: string): Promise<boolean> {
		const harness = await this.loader.getHarness(MatCheckboxHarness.with({ selector: `[data-testid="${this.ids.nodeCheckbox(path)}"]` }));
		return harness.isChecked();
	}

	async isNodeIndeterminate(path: string): Promise<boolean> {
		const harness = await this.loader.getHarness(MatCheckboxHarness.with({ selector: `[data-testid="${this.ids.nodeCheckbox(path)}"]` }));
		return harness.isIndeterminate();
	}

	async getSelectionCount(): Promise<number> {
		if (!this.has(this.ids.selectionCount)) return 0;
		const text = this.text(this.ids.selectionCount);
		const match = text?.match(/\((\d+)\)/);
		return match ? parseInt(match[1], 10) : 0;
	}

	async getSelectedFilePathsFromTable(): Promise<string[]> {
		const rows = this.findAll('selection-row-');
		return rows.map((row) => row.attributes['data-testid']?.replace('selection-row-', '') ?? '');
	}

	async getSubmissionError(): Promise<string | null> {
		return this.has(this.ids.submissionError) ? this.text(this.ids.submissionError) : null;
	}

	async isSubmitButtonDisabled(): Promise<boolean> {
		const harness = await this.loader.getHarness(MatButtonHarness.with({ selector: `[data-testid="${this.ids.submitButton}"]` }));
		return harness.isDisabled();
	}

	async isSubmitting(): Promise<boolean> {
		return this.has(this.ids.submitSpinner);
	}

	// --- Actions ---

	async clickRetryFileTree(): Promise<void> {
		await this.click(this.ids.fileTreeRetryButton);
	}

	async toggleNodeSelection(path: string): Promise<void> {
		const harness = await this.loader.getHarness(MatCheckboxHarness.with({ selector: `[data-testid="${this.ids.nodeCheckbox(path)}"]` }));
		await harness.toggle();
		await this.detectAndWait();
	}

	async removeFileFromSelection(path: string): Promise<void> {
		await this.click(this.ids.removeFileButton(path));
	}

	async setInstructions(text: string): Promise<void> {
		const harness = await this.loader.getHarness(MatInputHarness.with({ selector: `[data-testid="${this.ids.instructionsTextarea}"]` }));
		await harness.setValue(text);
		await this.detectAndWait();
	}

	async clickSubmit(): Promise<void> {
		await this.click(this.ids.submitButton);
	}
}
