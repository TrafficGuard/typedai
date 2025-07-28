import { MatButtonHarness } from '@angular/material/button/testing';
import { MatChipGridHarness, MatChipInputHarness } from '@angular/material/chips/testing';
import { MatExpansionPanelHarness } from '@angular/material/expansion/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSliderHarness } from '@angular/material/slider/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { By } from '@angular/platform-browser';
import { BaseSpecPo } from '../../../../test/base.po';
import type { PromptFormComponent } from './prompt-form.component';

/**
 * A custom harness to abstract interactions with a single message panel.
 * This encapsulates the logic for interacting with the complex, repeated structure of a message item.
 */
class MessagePanelHarness extends MatExpansionPanelHarness {
	static override hostSelector = 'mat-expansion-panel[formGroupName]';

	/**
	 * Gets the role text (e.g., 'User', 'Assistant') from the panel header.
	 * @returns A promise that resolves to the role string.
	 */
	async getRole(): Promise<string> {
		const titleElement = await this.locatorFor('.mat-panel-title')();
		const fullText = await titleElement.text();
		// The title can be "User - Some content..." or just "System". We extract the role part.
		return fullText.split('-')[0].trim();
	}

	/**
	 * Gets the harness for the message content textarea.
	 * @returns A promise that resolves to the MatInputHarness.
	 */
	async getContentHarness(): Promise<MatInputHarness> {
		return this.getHarness(MatInputHarness.with({ selector: 'textarea' }));
	}

	/**
	 * Gets the text content of the message.
	 * @returns A promise that resolves to the content string.
	 */
	async getContent(): Promise<string> {
		const textarea = await this.getContentHarness();
		return textarea.getValue();
	}

	/**
	 * Sets the text content of the message.
	 * @param text The new content to set.
	 */
	async setContent(text: string): Promise<void> {
		const textarea = await this.getContentHarness();
		await textarea.setValue(text);
	}

	/**
	 * Clicks the remove button for this message.
	 */
	async clickRemoveButton(): Promise<void> {
		const removeButton = await this.locatorFor(MatButtonHarness.with({ selector: '[mattooltip="Remove Message"]' }))();
		await removeButton.click();
	}

	/**
	 * Checks if the remove button is visible for this message.
	 * @returns A promise that resolves to true if the button is present.
	 */
	async isRemoveButtonVisible(): Promise<boolean> {
		const buttons = await this.getAllHarnesses(MatButtonHarness.with({ selector: '[mattooltip="Remove Message"]' }));
		return buttons.length > 0;
	}

	/**
	 * Gets the filenames of all attachments in this message.
	 * @returns A promise that resolves to an array of filenames.
	 */
	async getAttachmentNames(): Promise<string[]> {
		const attachmentPreviews = await this.locatorForAll('.attachment-previews [mattooltip]')();
		// The tooltip is the filename, so we map over the elements and get that attribute.
		return Promise.all(attachmentPreviews.map((p) => p.getAttribute('mattooltip')));
	}

	/**
	 * Clicks the remove button for a specific attachment.
	 * @param index The zero-based index of the attachment to remove.
	 */
	async removeAttachment(index: number): Promise<void> {
		const removeButtons = await this.locatorForAll(
			MatButtonHarness.with({ selector: '.attachment-previews button[mattooltip^="Remove"]' }),
		)();
		if (removeButtons[index]) {
			await removeButtons[index].click();
		} else {
			throw new Error(`Attachment remove button at index ${index} not found.`);
		}
	}
}

/**
 * Page Object for the PromptFormComponent.
 * Provides an API to interact with the component's template in a way that simulates user behavior.
 */
export class PromptFormPo extends BaseSpecPo<PromptFormComponent> {
	private readonly ids = {
		// Details
		nameInput: MatInputHarness.with({ selector: '[formControlName="name"]' }),
		tagsInput: MatChipInputHarness.with({ placeholder: 'New tag...' }),
		tagsList: MatChipGridHarness,
		systemMessageToggle: MatSlideToggleHarness.with({ selector: '[formControlName="includeSystemMessage"]' }),
		addMessageButton: MatButtonHarness.with({ selector: '[matTooltip="Add Message"]' }),
		copyXmlButton: MatButtonHarness.with({ selector: '[matTooltip="Copy Messages as XML"]' }),

		// Options
		modelSelect: MatSelectHarness.with({ selector: '[formControlName="llmId"]' }),
		temperatureSlider: MatSliderHarness.with({ selector: '[formControlName="temperature"]' }),
		maxTokensSlider: MatSliderHarness.with({ selector: '[formControlName="maxOutputTokens"]' }),
		temperatureValue: '.parameter-item:nth-child(2) .text-sm',
		maxTokensValue: '.parameter-item:nth-child(3) .text-sm',

		// Actions
		generateButton: MatButtonHarness.with({ text: 'Generate' }),
		backButton: MatButtonHarness.with({ text: 'Back' }),
		saveButton: MatButtonHarness.with({ selector: 'button[type="submit"]' }),

		// Right Pane
		generatingSpinner: '.flex-col.items-center.justify-center mat-spinner',
		generationResponse: '.prose pre',
		generationError: '.p-4.bg-red-50',
		addToPromptButton: MatButtonHarness.with({ text: 'Add to prompt' }),

		// Attachments
		fileInput: 'input[type="file"]',
	};

	// --- Details Section ---

	async setName(name: string): Promise<void> {
		await this.harness(this.ids.nameInput).then((h) => h.setValue(name));
	}

	async getName(): Promise<string> {
		return this.harness(this.ids.nameInput).then((h) => h.getValue());
	}

	async addTag(tag: string): Promise<void> {
		const input = await this.harness(this.ids.tagsInput);
		await input.setValue(tag);
		await input.sendSeparatorKey('Enter');
	}

	async getTags(): Promise<string[]> {
		const list = await this.harness(this.ids.tagsList);
		const chips = await list.getRows();
		return Promise.all(chips.map((c) => c.getText()));
	}

	async removeTag(tagText: string): Promise<void> {
		const list = await this.harness(this.ids.tagsList);
		const chips = await list.getRows({ text: tagText });
		if (chips.length > 0) {
			await chips[0].remove();
		}
	}

	// --- Messages Section ---

	async includeSystemMessage(include: boolean): Promise<void> {
		const toggle = await this.harness(this.ids.systemMessageToggle);
		const isChecked = await toggle.isChecked();
		if (isChecked !== include) {
			await toggle.toggle();
		}
	}

	async isSystemMessageIncluded(): Promise<boolean> {
		return this.harness(this.ids.systemMessageToggle).then((h) => h.isChecked());
	}

	async clickAddMessage(): Promise<void> {
		await this.harness(this.ids.addMessageButton).then((h) => h.click());
	}

	async clickCopyMessagesAsXml(): Promise<void> {
		await this.harness(this.ids.copyXmlButton).then((h) => h.click());
	}

	async getMessagePanels(): Promise<MessagePanelHarness[]> {
		return this.loader.getAllHarnesses(MessagePanelHarness);
	}

	async getMessagePanel(index: number): Promise<MessagePanelHarness> {
		const panels = await this.getMessagePanels();
		if (!panels[index]) {
			throw new Error(`Message panel at index ${index} not found.`);
		}
		return panels[index];
	}

	async attachFile(messageIndex: number, file: File): Promise<void> {
		const fileInputs = this.fix.debugElement.queryAll(By.css(this.ids.fileInput));
		const specificInput = fileInputs[messageIndex];
		if (!specificInput) {
			throw new Error(`File input for message at index ${messageIndex} not found.`);
		}
		const inputId = `file-input-${messageIndex}`;
		specificInput.nativeElement.setAttribute('data-testid', inputId);
		await this.setFiles(inputId, [file]);
	}

	// --- Generation Options Section ---

	async selectModel(modelName: string): Promise<void> {
		const select = await this.harness(this.ids.modelSelect);
		await select.open();
		await select.clickOptions({ text: modelName });
	}

	async getSelectedModel(): Promise<string> {
		return this.harness(this.ids.modelSelect).then((h) => h.getValueText());
	}

	async setTemperature(value: number): Promise<void> {
		const slider = await this.harness(this.ids.temperatureSlider);
		const thumb = await slider.getEndThumb();
		await thumb.setValue(value);
	}

	async getTemperatureValue(): Promise<string> {
		return this.text(this.ids.temperatureValue);
	}

	async setMaxTokens(value: number): Promise<void> {
		const slider = await this.harness(this.ids.maxTokensSlider);
		const thumb = await slider.getEndThumb();
		await thumb.setValue(value);
	}

	async getMaxTokensValue(): Promise<string> {
		return this.text(this.ids.maxTokensValue);
	}

	// --- Main Actions ---

	async clickGenerate(): Promise<void> {
		await this.harness(this.ids.generateButton).then((h) => h.click());
	}

	async isGenerateButtonDisabled(): Promise<boolean> {
		return this.harness(this.ids.generateButton).then((h) => h.isDisabled());
	}

	async clickBackButton(): Promise<void> {
		await this.harness(this.ids.backButton).then((h) => h.click());
	}

	async clickSave(): Promise<void> {
		await this.harness(this.ids.saveButton).then((h) => h.click());
	}

	async getSaveButtonText(): Promise<string> {
		return this.harness(this.ids.saveButton).then((h) => h.getText());
	}

	async isSaveButtonDisabled(): Promise<boolean> {
		return this.harness(this.ids.saveButton).then((h) => h.isDisabled());
	}

	// --- Right Pane (Response) ---

	async isGenerating(): Promise<boolean> {
		return this.has(this.ids.generatingSpinner);
	}

	async getGenerationResponse(): Promise<string | null> {
		if (await this.has(this.ids.generationResponse)) {
			return this.text(this.ids.generationResponse);
		}
		return null;
	}

	async getGenerationError(): Promise<string | null> {
		if (await this.has(this.ids.generationError)) {
			return this.text(this.ids.generationError);
		}
		return null;
	}

	async isAddToPromptButtonVisible(): Promise<boolean> {
		const buttons = await this.loader.getAllHarnesses(this.ids.addToPromptButton);
		return buttons.length > 0;
	}

	async clickAddToPrompt(): Promise<void> {
		await this.harness(this.ids.addToPromptButton).then((h) => h.click());
	}
}
