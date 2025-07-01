import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';

import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
// Import Material Modules for TestBed if not already imported by standalone component
import { MatSelectModule } from '@angular/material/select';
import { NewWorkflowsAgentComponent } from './new-workflows-agent.component';
import { NewWorkflowsAgentPo } from './new-workflows-agent.component.po';
// Corrected import path for WorkflowsService
import { WorkflowsService } from './workflows.service';
import { MatButtonHarness } from '@angular/material/button/testing';

xdescribe('NewWorkflowsAgentComponent', () => {
	let fixture: ComponentFixture<NewWorkflowsAgentComponent>;
	let component: NewWorkflowsAgentComponent;
	let po: NewWorkflowsAgentPo;
	let mockWorkflowsService: jasmine.SpyObj<WorkflowsService>;

	beforeEach(async () => {
		mockWorkflowsService = jasmine.createSpyObj('WorkflowsService', [
			'runCodeEditorImplementRequirements',
			'runCodebaseQuery',
			'selectFilesToEdit',
			'loadRepositories', // Ensure this is spied on if called by component
			'repositoriesState', // Ensure this is spied on if called by component
		]);

		// Default mock implementations
		// For repositoriesState, it should return a signal-like structure if the component uses it directly
		// The component's ngOnInit calls loadRepositories, which likely updates a signal.
		// We need to mock repositoriesState to control the data for the computed signals.
		mockWorkflowsService.repositoriesState.and.returnValue({ status: 'success', data: ['repo1', 'repo2'] });
		mockWorkflowsService.runCodeEditorImplementRequirements.and.returnValue(of({ result: 'code implemented' }));
		mockWorkflowsService.runCodebaseQuery.and.returnValue(of({ response: 'query response' }));
		mockWorkflowsService.selectFilesToEdit.and.returnValue(of({ files: ['file1.ts'] }));
		mockWorkflowsService.loadRepositories.and.stub(); // Stub this as it's called in ngOnInit

		await TestBed.configureTestingModule({
			imports: [
				NewWorkflowsAgentComponent, // Standalone component
				NoopAnimationsModule,
				// Material modules are typically imported by the standalone component itself.
				// Adding them here ensures they are available if TestBed needs them explicitly.
				CommonModule,
				ReactiveFormsModule,
				MatFormFieldModule,
				MatSelectModule,
				MatIconModule,
				MatCardModule,
				MatProgressBarModule,
				MatInputModule,
				MatButtonModule,
			],
			providers: [{ provide: WorkflowsService, useValue: mockWorkflowsService }],
		}).compileComponents();

		fixture = TestBed.createComponent(NewWorkflowsAgentComponent);
		component = fixture.componentInstance;
		po = await NewWorkflowsAgentPo.create(fixture);
		// fixture.detectChanges() is called by BaseSpecPo.create and po.detectAndWait()
	});

	it('should create', () => {
		expect(component).toBeTruthy();
		expect(po).toBeTruthy();
	});

	describe('Initialization', () => {
		it('should initialize the form with default workflow type and empty input', async () => {
			expect(await po.getWorkflowTypeValue()).toBe('Code Edit Workflow'); // Assuming 'code' is default and maps to this text
			expect(await po.getInputValue()).toBe('');
			// Initial working directory depends on repository loading
		});

		it('should load repositories and set the first one as default in workingDirectory', async () => {
			// ngOnInit calls loadRepositories, which should trigger the repositoriesState to update.
			// The component constructor subscribes to repositoriesData which patches the form.
			// Need to ensure mockWorkflowsService.repositoriesState() is set up before component creation or detectChanges.
			// The beforeEach already sets up repositoriesState.
			// fixture.detectChanges(); // Allow computed signals and effects to run
			// await fixture.whenStable();

			expect(mockWorkflowsService.loadRepositories).toHaveBeenCalled();
			// Check the DOM via PO
			expect(await po.getWorkingDirectoryValue()).toBe('repo1');
		});

		it('should display error if fetching repositories fails', async () => {
			mockWorkflowsService.repositoriesState.and.returnValue({
				status: 'error',
				error: new Error('Fetch error'),
			});
			// Re-trigger ngOnInit or simulate the error state update
			component.ngOnInit(); // This will call loadRepositories again, which uses the new mockState
			await po.detectAndWait();

			expect(await po.getResultText()).toContain('Error fetching repositories: Fetch error. Please try again later.');
		});
	});

	describe('Form Behavior', () => {
		it('should update input label when "Code Edit Workflow" workflow type is selected', async () => {
			await po.selectWorkflowType('Code Edit Workflow'); // Text for 'code'
			expect(await po.getInputLabelText()).toBe('Requirements');
		});

		it('should update input label when "Codebase Query" workflow type is selected', async () => {
			await po.selectWorkflowType('Codebase Query'); // Text for 'query'
			expect(await po.getInputLabelText()).toBe('Query');
		});

		it('should update input label when "Select Files To Edit" workflow type is selected', async () => {
			await po.selectWorkflowType('Select Files To Edit'); // Text for 'selectFiles'
			expect(await po.getInputLabelText()).toBe('Requirements for File Selection');
		});

		it('should disable submit button if input is empty (form invalid)', async () => {
			await po.setValidFormValues({ workingDirectory: 'repo1', workflowType: 'Code Edit Workflow', input: '' });
			expect(await po.isSubmitButtonEnabled()).toBeFalse();
		});

		it('should enable submit button if form is valid', async () => {
			await po.setValidFormValues({
				workingDirectory: 'repo1',
				workflowType: 'Code Edit Workflow',
				input: 'test input',
			});
			expect(await po.isSubmitButtonEnabled()).toBeTrue();
		});
	});

	describe('Workflow Execution', () => {
		const testCases = [
			{
				workflowTypeLabel: 'Code Edit Workflow',
				serviceMethod: 'runCodeEditorImplementRequirements',
				serviceArgs: ['repo1', 'implement this'],
				mockResponse: { result: 'code implemented' },
				expectedResult: JSON.stringify({ result: 'code implemented' }, null, 2),
			},
			{
				workflowTypeLabel: 'Codebase Query',
				serviceMethod: 'runCodebaseQuery',
				serviceArgs: ['repo1', 'query this'],
				mockResponse: { response: 'query response' },
				expectedResult: 'query response',
			},
			{
				workflowTypeLabel: 'Select Files To Edit',
				serviceMethod: 'selectFilesToEdit',
				serviceArgs: ['repo1', 'select for this'],
				mockResponse: { files: ['file1.ts'] },
				expectedResult: JSON.stringify({ files: ['file1.ts'] }, null, 2),
			},
		] as const;

		for (const tc of testCases) {
			it(`should execute "${tc.workflowTypeLabel}" workflow successfully`, async () => {
// 				The problem is that TypeScript can't connect that the 'runCodebaseQuery' method is always paired with the { response: ... } shape. It checks the mockResponse against the requirements for all possible methods in the union, and the type check fails because, for example, a response of { result: '...' } doesn't have the response property required by the runCodebaseQuery method.
// This is a well-known limitation in TypeScript often referred to as a "correlated unions" problem.
				mockWorkflowsService[tc.serviceMethod].and.returnValue(of(tc.mockResponse as any));

				await po.setValidFormValues({
					workingDirectory: tc.serviceArgs[0],
					workflowType: tc.workflowTypeLabel,
					input: tc.serviceArgs[1],
				});
				await po.clickSubmitButton();

				expect(mockWorkflowsService[tc.serviceMethod]).toHaveBeenCalledWith(tc.serviceArgs[0], tc.serviceArgs[1]);
				expect(await po.isLoadingIndicatorVisible()).toBeFalse(); // After completion
				expect(await po.getResultText()).toBe(tc.expectedResult);
			});

			it(`should display error when "${tc.workflowTypeLabel}" workflow service call fails`, async () => {
				const errorMessage = 'Service failure';
				mockWorkflowsService[tc.serviceMethod].and.returnValue(throwError(() => new Error(errorMessage)));

				await po.setValidFormValues({
					workingDirectory: tc.serviceArgs[0],
					workflowType: tc.workflowTypeLabel,
					input: tc.serviceArgs[1],
				});
				await po.clickSubmitButton();

				const workflowTypeValue = component.codeForm.get('workflowType')?.value; // get the internal value for error message check
				expect(mockWorkflowsService[tc.serviceMethod]).toHaveBeenCalledWith(tc.serviceArgs[0], tc.serviceArgs[1]);
				expect(await po.isLoadingIndicatorVisible()).toBeFalse();
				expect(await po.getResultText()).toBe(`Error during ${workflowTypeValue} operation: ${errorMessage}`);
			});
		}

		it('should not call any service if form is invalid on submit', async () => {
			// Ensure form is invalid, e.g., by clearing a required field
			await po.selectWorkingDirectory('repo1');
			await po.selectWorkflowType('Code Edit Workflow');
			await po.typeInInput(''); // Makes input invalid

			await po.clickSubmitButton();

			expect(mockWorkflowsService.runCodeEditorImplementRequirements).not.toHaveBeenCalled();
			expect(mockWorkflowsService.runCodebaseQuery).not.toHaveBeenCalled();
			expect(mockWorkflowsService.selectFilesToEdit).not.toHaveBeenCalled();
			expect(await po.isLoadingIndicatorVisible()).toBeFalse();
		});

		it('should show loading indicator during operation and hide after completion', async () => {
			mockWorkflowsService.runCodeEditorImplementRequirements.and.returnValue(
				new Observable((observer) => {
					// Simulate async operation
					expect(component.isLoading).toBeTrue(); // Check internal state if PO can't easily catch this mid-flight
					// To check with PO, we'd need more complex timing or a way for the service to pause
					setTimeout(() => {
						observer.next({ result: 'code implemented' });
						observer.complete();
					}, 50);
				}),
			);

			await po.setValidFormValues({
				workingDirectory: 'repo1',
				workflowType: 'Code Edit Workflow',
				input: 'test input',
			});

			// Click submit but don't wait for full completion in po.clickSubmitButton's detectAndWait
			const button = await po.harness(MatButtonHarness, { selector: `[data-testid="submit-button"]` });
			await button.click();
			fixture.detectChanges(); // Start the process

			expect(await po.isLoadingIndicatorVisible()).toBeTrue(); // Check immediately after click

			await fixture.whenStable(); // Wait for async operations in the service mock to complete
			await po.detectAndWait(); // Ensure UI updates after operation

			expect(await po.isLoadingIndicatorVisible()).toBeFalse();
			expect(await po.getResultText()).toBe(JSON.stringify({ result: 'code implemented' }, null, 2));
		});
	});
});
