import { ComponentFixture } from '@angular/core/testing';
import { MatExpansionPanelHarness } from '@angular/material/expansion/testing';
import { By } from '@angular/platform-browser';
import { BaseSpecPo } from '../../../../../test/base.po';
import { AgentMemoryComponent } from './agent-memory.component';

export class AgentMemoryPo extends BaseSpecPo<AgentMemoryComponent> {
	private ids = {
		noMemoryMessage: 'no-memory-message',
		noMemoryMessageAlt: 'no-memory-message-alt',
		// Dynamic IDs will be constructed in methods, e.g., `memory-entry-${key}`
	} as const;

	private getExpansionPanelHarness(key: string): Promise<MatExpansionPanelHarness> {
		return this.harness(MatExpansionPanelHarness, { selector: `[data-testid="memory-entry-${key}"]` });
	}

	async getMemoryEntryKeys(): Promise<string[]> {
		const titleElements = this.fix.debugElement.queryAll(By.css('[data-testid^="memory-key-"]'));
		return titleElements.map((el) => el.nativeElement.textContent.trim());
	}

	async getMemoryEntryValuePreview(key: string): Promise<string> {
		return this.text(`memory-value-preview-${key}`);
	}

	async getMemoryEntryFullValue(key: string): Promise<string> {
		const element = this.el(`memory-value-full-${key}`);
		return element.nativeElement.innerHTML;
	}

	async isMemoryEntryExpanded(key: string): Promise<boolean> {
		const panelHarness = await this.getExpansionPanelHarness(key);
		return panelHarness.isExpanded();
	}

	async toggleMemoryEntry(key: string): Promise<void> {
		const panelHarness = await this.getExpansionPanelHarness(key);
		await panelHarness.toggle();
		// Harness actions usually handle change detection, but an explicit detectAndWait can be added if needed.
		// BaseSpecPo's harness method or specific harness methods might already include this.
	}

	async hasNoMemoryMessage(): Promise<boolean> {
		const hasMainMessage = this.has(this.ids.noMemoryMessage);
		const hasAltMessage = this.has(this.ids.noMemoryMessageAlt);
		return hasMainMessage || hasAltMessage;
	}

	// Inherits static create method from BaseSpecPo
	// static async create(fixture: ComponentFixture<AgentMemoryComponent>): Promise<AgentMemoryPo> {
	//  fixture.detectChanges();
	//  await fixture.whenStable();
	//  fixture.detectChanges();
	//  return new AgentMemoryPo(fixture);
	// }
	// Note: The above 'create' is illustrative of what BaseSpecPo.create should achieve for AgentMemoryPo.
	// The actual implementation is in BaseSpecPo.
}
