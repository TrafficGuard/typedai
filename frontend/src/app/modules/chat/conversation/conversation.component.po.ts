// tests/po/conversation.po.ts
import { ComponentFixture }       from '@angular/core/testing';
import { MatInputHarness }        from '@angular/material/input/testing';
import { MatButtonHarness }       from '@angular/material/button/testing';
import { MatSelectHarness }       from '@angular/material/select/testing';
import { MatSliderHarness } from '@angular/material/slider/testing';
import { ConversationComponent }  from './conversation.component';
import {BaseSpecPo} from "../../../../test/base.po";
import { By } from '@angular/platform-browser'; // <-- Add this line
import { ChatInfoPo } from '../chat-info/chat-info.component.po';

export class ConversationPo extends BaseSpecPo<ConversationComponent> {

    /* ────────────── ids used here ― change once if template changes ― */
    private ids = {
        loading : 'loading',
        title   : 'chat-title',
        msgList : 'msg-list',
        input   : 'msg-input',
        send    : 'send-btn',
        attach  : 'file-input',
        llmSel  : 'llm-select',
        toggleEnter : 'toggle-enter-btn',
        openInfo    : 'open-info-btn',
        infoDrawer  : 'info-drawer',
    } as const;

    /* ────────────── state queries ─────────────────────────────────── */
    isLoading()           { return this.has(this.ids.loading); }
    chatTitle()           { return this.text(this.ids.title); }
    messageCount()        { return this.el(this.ids.msgList).queryAll(By.css('*')).length; } // <-- Modify this line
    inputValue()          { return this.value(this.ids.input); }

    /* ────────────── user actions ──────────────────────────────────── */
    async typeMessage(txt: string) {
        await (await this.harness(MatInputHarness,
            { selector: `[data-testid="${this.ids.input}"]` })).setValue(txt);
    }

    async clickSend() {
        await (await this.harness(MatButtonHarness,
            { selector: `[data-testid="${this.ids.send}"]` })).click();
    }

    async pressEnter() { await this.pressKey(this.ids.input, 'Enter'); }

    async chooseLlmByText(text: string) {
        const sel = await this.harness(MatSelectHarness,
            { selector: `[data-testid="${this.ids.llmSel}"]` });
        await sel.open();           // auto change-detects
        await sel.clickOptions({ text });
    }

    async attach(files: File[]) {
        await this.setFiles(this.ids.attach, files);
    }

    async openDrawer() {
        await this.click(this.ids.openInfo);
    }

    async openChatInfo(): Promise<ChatInfoPo> {
        await this.openDrawer();
        await this.detectAndWait();
        return ChatInfoPo.create(this.fix as any);
    }

    async setTemperature(value: number): Promise<void> {
        const chatInfo = await this.openChatInfo();
        await chatInfo.setSliderValue('temperatureSlider', value);
    }

    drawerOpened() {
        return this.el(this.ids.infoDrawer)
                  .nativeElement.classList.contains('mat-drawer-opened');
    }

    // The static create method is inherited from BaseSpecPo and handles polymorphism correctly.
    // No need to redefine it here.
}
