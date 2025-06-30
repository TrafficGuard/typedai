import { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatSliderHarness } from '@angular/material/slider/testing';
import { BaseSpecPo } from '../../../../test/base.po';
import { ChatInfoComponent } from './chat-info.component';

export class ChatInfoPo extends BaseSpecPo<ChatInfoComponent> {
	private readonly ids = {
		panelTitle: 'panel-title',
		chatTitleDisplay: 'chat-title-display',
		chatIdDisplay: 'chat-id-display',

		editNameButton: 'edit-name-btn',
		saveNameButton: 'save-name-btn',
		cancelEditNameButton: 'cancel-edit-name-btn',
		nameInput: 'name-input',

		deleteChatButton: 'delete-chat-btn',
		databaseUrlLink: 'database-url-link',

		temperatureSlider: 'temperature-slider',
		topPSlider: 'topP-slider',
		topKSlider: 'topK-slider',
		presencePenaltySlider: 'presencePenalty-slider',
		frequencyPenaltySlider: 'frequencyPenalty-slider',

		settingsErrorDisplay: 'settings-error-display',
		settingsLoadingSpinner: 'settings-loading-spinner',
		nameSavingSpinner: 'name-saving-spinner',
		chatDeletingSpinner: 'chat-deleting-spinner',
	} as const;

	// State Queries
	async getPanelTitle(): Promise<string> {
		return this.text(this.ids.panelTitle);
	}

	async getChatTitle(): Promise<string> {
		return this.text(this.ids.chatTitleDisplay);
	}

	async getChatId(): Promise<string | null> {
		if (this.has(this.ids.chatIdDisplay)) {
			const text = await this.text(this.ids.chatIdDisplay); // await here
			return text.replace('ID: ', '').trim();
		}
		return null;
	}

	async isEditNameButtonVisible(): Promise<boolean> {
		return this.has(this.ids.editNameButton);
	}

	async isSaveNameButtonVisible(): Promise<boolean> {
		return this.has(this.ids.saveNameButton);
	}

	async isCancelEditNameButtonVisible(): Promise<boolean> {
		return this.has(this.ids.cancelEditNameButton);
	}

	async isNameInputVisible(): Promise<boolean> {
		return this.has(this.ids.nameInput);
	}

	async getNameInputValue(): Promise<string> {
		return this.value(this.ids.nameInput);
	}

	async isDeleteChatButtonEnabled(): Promise<boolean> {
		const button = await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.deleteChatButton}"]` });
		return !(await button.isDisabled());
	}

	async getDatabaseUrl(): Promise<string | null> {
		if (this.has(this.ids.databaseUrlLink)) {
			return this.el(this.ids.databaseUrlLink).nativeElement.getAttribute('href');
		}
		return null;
	}

	async getSliderValue(sliderTestId: keyof typeof this.ids): Promise<number> {
		const sliderHarness = await this.harness(MatSliderHarness, { selector: `[data-testid="${this.ids[sliderTestId]}"]` });
		// TODO what is correct API usage for a single value slider?
		return (await sliderHarness.getMinValue()) || sliderHarness.getMaxValue();
	}

	async getSettingsErrorText(): Promise<string | null> {
		if (this.has(this.ids.settingsErrorDisplay)) {
			const text = await this.text(this.ids.settingsErrorDisplay); // await here
			return text.replace('Error: ', '').trim();
		}
		return null;
	}

	async isSettingsLoadingVisible(): Promise<boolean> {
		return this.has(this.ids.settingsLoadingSpinner);
	}

	async isNameSavingVisible(): Promise<boolean> {
		return this.has(this.ids.nameSavingSpinner);
	}

	async isChatDeletingVisible(): Promise<boolean> {
		return this.has(this.ids.chatDeletingSpinner);
	}

	// User Actions
	async clickEditNameButton(): Promise<void> {
		await this.click(this.ids.editNameButton);
	}

	async clickSaveNameButton(): Promise<void> {
		// Use harness for potentially disabled button
		const button = await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.saveNameButton}"]` });
		await button.click();
		await this.detectAndWait();
	}

	async clickCancelEditNameButton(): Promise<void> {
		await this.click(this.ids.cancelEditNameButton);
	}

	async typeNameInInput(name: string): Promise<void> {
		await this.type(this.ids.nameInput, name);
	}

	async clickDeleteChatButton(): Promise<void> {
		const button = await this.harness(MatButtonHarness, { selector: `[data-testid="${this.ids.deleteChatButton}"]` });
		await button.click();
		await this.detectAndWait();
	}

	async setSliderValue(sliderTestId: keyof typeof this.ids, value: number): Promise<void> {
		const sliderHarness = await this.harness(MatSliderHarness, { selector: `[data-testid="${this.ids[sliderTestId]}"]` });
		throw new Error('TODO implement setSliderValue()');
		// await sliderHarness.setValue(value); // invalid
		// await this.detectAndWait(); // ngModelChange should trigger onSettingChange
	}
}
