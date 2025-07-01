import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { NewAgentComponent } from './new-agent.component';
import { NewAgentPo } from './new-agent.component.po';

// Import real child components to be able to reference their symbols in overrideComponent
import { NewAutonomousAgentComponent as RealNewAutonomousAgentComponent } from './new-autonomous-agent/new-autonomous-agent.component';
import { NewWorkflowsAgentComponent as RealNewWorkflowsAgentComponent } from './new-workflows-agent/new-workflows-agent.component';

// Stub components
@Component({
	selector: 'new-autonomous-agent', // Matches the original selector
	template: '<div data-testid="stub-autonomous-agent">Autonomous Agent Stub</div>',
	standalone: true,
})
class StubNewAutonomousAgentComponent {}

@Component({
	selector: 'new-workflows-agent', // Matches the original selector
	template: '<div data-testid="stub-workflows-agent">Workflows Agent Stub</div>',
	standalone: true,
})
class StubNewWorkflowsAgentComponent {}

xdescribe('NewAgentComponent', () => {
	let component: NewAgentComponent;
	let fixture: ComponentFixture<NewAgentComponent>;
	let po: NewAgentPo;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [
				NewAgentComponent, // Import the component under test
				NoopAnimationsModule,
				// NewAgentComponent's own 'imports' array already includes CommonModule, ReactiveFormsModule, MatRadioModule, MatCard, MatCardContent.
				// Stubs will be provided via overrideComponent.
			],
			// No declarations needed for standalone components here.
		})
			.overrideComponent(NewAgentComponent, {
				remove: {
					imports: [RealNewAutonomousAgentComponent, RealNewWorkflowsAgentComponent],
				},
				add: {
					imports: [StubNewAutonomousAgentComponent, StubNewWorkflowsAgentComponent],
				},
			})
			.compileComponents();

		fixture = TestBed.createComponent(NewAgentComponent);
		component = fixture.componentInstance;
		po = await NewAgentPo.create(fixture); // Calls detectChanges and whenStable
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	it('should initialize with "autonomous" agent type selected by default', async () => {
		// Assert
		expect(component.agentTypeControl.value).toBe('autonomous');
		expect(await po.getSelectedAgentType()).toBe('autonomous');
	});

	it('should display the autonomous agent stub component by default and hide workflows agent stub', async () => {
		// Assert
		expect(await po.isAutonomousAgentStubVisible()).toBe(true);
		expect(await po.isWorkflowsAgentStubVisible()).toBe(false);
	});

	describe('Agent Type Selection', () => {
		it('should switch to workflows agent stub component when "Workflows Agent" radio is selected', async () => {
			// Act
			await po.selectAgentType('workflow');

			// Assert
			expect(component.agentTypeControl.value).toBe('workflow');
			expect(await po.getSelectedAgentType()).toBe('workflow');
			expect(await po.isAutonomousAgentStubVisible()).toBe(false);
			expect(await po.isWorkflowsAgentStubVisible()).toBe(true);
		});

		it('should switch back to autonomous agent stub component when "Autonomous Agent" radio is selected after workflows', async () => {
			// Arrange: select workflows first
			await po.selectAgentType('workflow');
			expect(component.agentTypeControl.value).toBe('workflow'); // Sanity check

			// Act: select autonomous
			await po.selectAgentType('autonomous');

			// Assert
			expect(component.agentTypeControl.value).toBe('autonomous');
			expect(await po.getSelectedAgentType()).toBe('autonomous');
			expect(await po.isAutonomousAgentStubVisible()).toBe(true);
			expect(await po.isWorkflowsAgentStubVisible()).toBe(false);
		});
	});

	// Test for console.log in ngOnInit is generally omitted as it's an implementation detail
	// and can make tests brittle. If logging is critical, it's usually done via a spyable service.
});
