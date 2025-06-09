import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ChatComponent } from './chat.component';

// Mock QuickChatComponent as it's a child of ChatComponent
@Component({
	selector: 'quick-chat',
	template: '',
	standalone: true,
})
class MockQuickChatComponent {}

describe('ChatComponent', () => {
	let component: ChatComponent;
	let fixture: ComponentFixture<ChatComponent>;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [
				CommonModule,
				RouterTestingModule, // For <router-outlet>
				ChatComponent, // Import the standalone component directly
				// MockQuickChatComponent is already standalone and ChatComponent imports it.
				// If QuickChatComponent were not standalone, we'd import MockQuickChatComponent here.
				// However, ChatComponent's imports array handles QuickChatComponent.
				// For testing, if QuickChatComponent is complex, providing a mock via imports
				// or overriding its provider might be done. Given ChatComponent imports QuickChatComponent directly,
				// and if QuickChatComponent is standalone, it should work.
				// If QuickChatComponent is NOT standalone, ChatComponent would fail to compile.
				// Assuming QuickChatComponent is standalone as per ChatComponent's imports.
				// If we want to ensure a MOCK is used instead of the real one:
				// Option 1: ChatComponent imports MockQuickChatComponent (modify ChatComponent.ts imports for test - not ideal)
				// Option 2: Override provider (more complex for standalone components imported directly)
				// Option 3: Ensure QuickChatComponent is simple or has its own tests.
				// For this case, we'll assume QuickChatComponent is standalone and correctly imported.
				// If a specific mock is needed to replace the actual QuickChatComponent for ChatComponent's tests:
				// TestBed.overrideComponent(ChatComponent, {
				//  remove: { imports: [QuickChatComponent] },
				//  add: { imports: [MockQuickChatComponent] }
				// });
				// This is more advanced. For now, we rely on ChatComponent's existing import.
			],
			// No declarations needed for standalone components.
			// No providers needed for this simple component's test.
		}).compileComponents();

		fixture = TestBed.createComponent(ChatComponent);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	it('should render router-outlet', () => {
		const compiled = fixture.nativeElement as HTMLElement;
		expect(compiled.querySelector('router-outlet')).not.toBeNull();
	});
});
