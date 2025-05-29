import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'; // Added HttpTestingController
import { type WritableSignal, signal } from '@angular/core'; // Added signal, WritableSignal
import { type ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'; // Added fakeAsync, tick
import { ReactiveFormsModule } from '@angular/forms'; // Added ReactiveFormsModule
import { MatCheckboxModule } from '@angular/material/checkbox'; // Added MatCheckboxModule
import { MatFormFieldModule } from '@angular/material/form-field'; // Added MatFormFieldModule
import { MatInputModule } from '@angular/material/input'; // Added MatInputModule
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // Added MatProgressSpinnerModule
import { MatSelectModule } from '@angular/material/select'; // Added MatSelectModule
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar'; // Added MatSnackBar
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router'; // Added Router
import { RouterTestingModule } from '@angular/router/testing';
import type { AsyncState } from 'app/core/api-state.types'; // Added AsyncState
import { UserService } from 'app/core/user/user.service';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs'; // Added Subject, BehaviorSubject, throwError
import type { AgentContextApi } from '#shared/agent/agent.schema';
import type { UserProfile } from '#shared/user/user.model'; // Added AgentContextApi
import { type LLM as LlmModel, LlmService } from '../../../llm.service'; // Corrected LlmModel import
import { AgentService, type AgentStartRequestData } from '../../agent.service'; // Added AgentService and AgentStartRequestData
import { NewAutonomousAgentComponent } from './new-autonomous-agent.component';

describe('NewAutonomousAgentComponent', () => {
	let component: NewAutonomousAgentComponent;
	let fixture: ComponentFixture<NewAutonomousAgentComponent>;
	let llmServiceMock: jasmine.SpyObj<LlmService>;
	let userServiceMock: jasmine.SpyObj<UserService>;
	let agentServiceMock: jasmine.SpyObj<AgentService>; // Added agentServiceMock
	let snackBarMock: jasmine.SpyObj<MatSnackBar>; // Added snackBarMock
	let routerMock: jasmine.SpyObj<Router>; // Added routerMock
	let httpMock: HttpTestingController;
	let userProfileSubject: BehaviorSubject<UserProfile | null>;
	let mockAvailableFunctionsSignal: WritableSignal<AsyncState<string[]>>;

	const mockLlms: LlmModel[] = [
		{ id: 'openai:gpt-4o-mini', name: 'GPT-4o Mini', isConfigured: true },
		{ id: 'anthropic:claude-3-5-haiku', name: 'Claude 3.5 Haiku', isConfigured: true },
	];

	const mockFunctions = ['GitLab', 'GitHub', 'FileAccess'];
	const mockUserProfile: UserProfile = {
		id: 'test-user',
		name: 'Test User',
		email: 'test@example.com',
		enabled: true,
		hilBudget: 10,
		hilCount: 5,
	};

	beforeEach(async () => {
		llmServiceMock = jasmine.createSpyObj('LlmService', ['getLlms']);
		llmServiceMock.getLlms.and.returnValue(of(mockLlms));

		userProfileSubject = new BehaviorSubject<UserProfile | null>(mockUserProfile);
		userServiceMock = jasmine.createSpyObj('UserService', ['get']);
		userServiceMock.get.and.returnValue(userProfileSubject.asObservable());

		mockAvailableFunctionsSignal = signal<AsyncState<string[]>>({ status: 'idle' });
		agentServiceMock = jasmine.createSpyObj('AgentService', ['startAgent', 'loadAvailableFunctions', 'availableFunctionsState']);
		agentServiceMock.availableFunctionsState.and.returnValue(mockAvailableFunctionsSignal.asReadonly());
		agentServiceMock.loadAvailableFunctions.and.stub();
		// Default startAgent mock, can be overridden in specific tests
		agentServiceMock.startAgent.and.returnValue(of({ agentId: 'mock-id' } as AgentContextApi));

		snackBarMock = jasmine.createSpyObj('MatSnackBar', ['open']);
		// Router mock needs to be a SpyObj to spy on navigate.
		// RouterTestingModule provides a stub Router, but for spying, a SpyObj is better.
		// However, RouterTestingModule is often used for routing related tests.
		// For this component, we only need to spy on `navigate`.
		// Let's inject Router and spy on its navigate method if RouterTestingModule doesn't suffice.
		// For now, we'll use RouterTestingModule and get the Router instance to spy on.

		await TestBed.configureTestingModule({
			imports: [
				NewAutonomousAgentComponent, // Standalone component
				NoopAnimationsModule,
				HttpClientTestingModule,
				RouterTestingModule,
				MatSnackBarModule,
				ReactiveFormsModule,
				MatSelectModule,
				MatFormFieldModule,
				MatInputModule,
				MatCheckboxModule,
				MatProgressSpinnerModule,
			],
			providers: [
				{ provide: LlmService, useValue: llmServiceMock },
				{ provide: UserService, useValue: userServiceMock },
				{ provide: AgentService, useValue: agentServiceMock },
				{ provide: MatSnackBar, useValue: snackBarMock },
				// Router is provided by RouterTestingModule
			],
		}).compileComponents();

		fixture = TestBed.createComponent(NewAutonomousAgentComponent);
		component = fixture.componentInstance;
		httpMock = TestBed.inject(HttpTestingController); // For any direct HTTP calls not mocked by services
		routerMock = TestBed.inject(Router) as jasmine.SpyObj<Router>; // Get router instance
		spyOn(routerMock, 'navigate').and.resolveTo(true); // Spy on navigate

		// Set initial state for available functions signal for tests that rely on functions being present after init
		mockAvailableFunctionsSignal.set({ status: 'success', data: [...mockFunctions] });

		fixture.detectChanges(); // Trigger constructor (effect setup) and ngOnInit (loadAvailableFunctions call)
		tick(); // Process async operations from ngOnInit (effect runs due to signal change)
		fixture.detectChanges(); // Reflect changes from effect

		// agentService.loadAvailableFunctions is mocked, so no httpMock for 'api/agent/v1/functions'

		// UserService.get() is called in loadUserProfile, which is called in ngOnInit.
		// The mock for userService.get() returns an observable, so no direct HTTP call for profile here.
		// If UserService itself made an HTTP call and wasn't mocked deeply, httpMock would catch it.
		// Since userService.get() is fully mocked to return userProfileSubject.asObservable(),
		// we don't expect a /api/profile/view call through httpMock here.

		fixture.detectChanges(); // Process async operations, including subscription to userService.get()
	});

	afterEach(() => {
		httpMock.verify(); // Ensure no outstanding HTTP calls unless they are from unmocked services
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	it('should initialize form with default values and load data on init', fakeAsync(() => {
		expect(component.runAgentForm).toBeDefined();
		expect(component.runAgentForm.get('subtype')?.value).toBe('codegen');
		expect(llmServiceMock.getLlms).toHaveBeenCalled();
		expect(agentServiceMock.loadAvailableFunctions).toHaveBeenCalled(); // Changed from getAvailableFunctions
		expect(component.llms).toEqual(mockLlms);
		// component.functions is populated by the effect due to mockAvailableFunctionsSignal being set in the main beforeEach
		expect(component.functions).toEqual(mockFunctions.sort()); // component sorts them
		expect(userServiceMock.get).toHaveBeenCalled();

		// Check if function controls are added based on mockFunctions from main beforeEach
		mockFunctions.forEach((_, index) => {
			expect(component.runAgentForm.get(`function${index}`)).toBeTruthy();
		});

		expect(component.runAgentForm.get('budget')?.value).toBe(mockUserProfile.hilBudget);
		expect(component.runAgentForm.get('count')?.value).toBe(mockUserProfile.hilCount);
		tick(); // Complete observables
	}));

	it('should handle null user profile from UserService', fakeAsync(() => {
		userProfileSubject.next(null); // Simulate UserService returning null
		tick();
		fixture.detectChanges();

		// Form values should not be patched, or patched with defaults if applicable
		expect(component.runAgentForm.get('budget')?.value).toBe(0); // Default from form init
		expect(component.runAgentForm.get('count')?.value).toBe(0); // Default from form init
	}));

	// Note: The original test 'should set isSubmitting to true on submit and false on finalize'
	// was testing direct HTTP call. This will be covered by the new onSubmit tests with AgentService mock.

	it('should update sharedRepos control based on Git function selection', fakeAsync(() => {
		tick(); // for initial effect run from ngOnInit (valueChanges subscription)
		fixture.detectChanges();

		const useSharedReposControl = component.runAgentForm.get('useSharedRepos');
		const gitLabFunctionIndex = component.functions.indexOf('GitLab');
		const gitLabControlName = `function${gitLabFunctionIndex}`;

		// Initially, no Git function selected, should be disabled
		expect(useSharedReposControl?.disabled).toBeTrue();
		expect(useSharedReposControl?.value).toBeFalse();

		// Select GitLab function
		component.runAgentForm.get(gitLabControlName)?.setValue(true);
		fixture.detectChanges();
		tick(); // for valueChanges effect to run
		fixture.detectChanges();

		expect(useSharedReposControl?.enabled).toBeTrue();

		// Deselect GitLab function
		component.runAgentForm.get(gitLabControlName)?.setValue(false);
		fixture.detectChanges();
		tick(); // for valueChanges effect to run
		fixture.detectChanges();

		expect(useSharedReposControl?.disabled).toBeTrue();
		expect(useSharedReposControl?.value).toBeFalse();
	}));

	it('should set LLM presets correctly', () => {
		component.setPreset('openai');
		if (mockLlms.length > 0 && mockLlms[0].id.startsWith('openai:gpt-4o-mini')) {
			expect(component.runAgentForm.get('llmEasy')?.value).toBe(mockLlms[0].id);
		} else {
			expect(component.runAgentForm.get('llmEasy')?.value).toBeDefined();
		}
	});

	describe('onSubmit', () => {
		beforeEach(fakeAsync(() => {
			// Made fakeAsync
			// Ensure functions are loaded via signal for these tests
			mockAvailableFunctionsSignal.set({ status: 'success', data: [...mockFunctions] });
			tick(); // Allow effect to run and populate functions and form controls
			fixture.detectChanges();

			// Ensure form is valid for most onSubmit tests
			component.runAgentForm.patchValue({
				name: 'Test Agent Name',
				userPrompt: 'Test agent prompt',
				subtype: 'codegen',
				llmEasy: mockLlms[0].id,
				llmMedium: mockLlms[0].id,
				llmHard: mockLlms[0].id,
				budget: 10,
				count: 5,
				useSharedRepos: true, // This will be enabled if a Git function is present and selected
			});

			// Select one function to make the payload more complete
			// Ensure the control exists (it should due to the signal above)
			if (component.functions.length > 0 && component.runAgentForm.get('function0')) {
				component.runAgentForm.get('function0')?.setValue(true);
			}
			fixture.detectChanges();
		}));

		it('should not call agentService.startAgent if form is invalid', () => {
			component.runAgentForm.get('name')?.setValue(''); // Make form invalid
			fixture.detectChanges();
			expect(component.runAgentForm.valid).toBeFalse();

			component.onSubmit();

			expect(agentServiceMock.startAgent).not.toHaveBeenCalled();
		});

		it('should call agentService.startAgent with correctly mapped payload when form is valid', () => {
			const mockAgentId = 'test-agent-id-123';
			agentServiceMock.startAgent.and.returnValue(of({ agentId: mockAgentId } as AgentContextApi));
			expect(component.runAgentForm.valid).toBeTrue();

			component.onSubmit();

			const expectedFunctions = component.functions.filter((_, index) => component.runAgentForm.value[`function${index}`]).map((tool) => tool);

			const expectedPayload: AgentStartRequestData = {
				agentName: 'Test Agent Name',
				initialPrompt: 'Test agent prompt',
				type: 'autonomous',
				subtype: 'codegen',
				functions: expectedFunctions,
				humanInLoop: { budget: 10, count: 5 },
				llms: { easy: mockLlms[0].id, medium: mockLlms[0].id, hard: mockLlms[0].id },
				useSharedRepos: true,
			};
			expect(agentServiceMock.startAgent).toHaveBeenCalledWith(expectedPayload);
		});

		it('should navigate to agent details and show success snackbar on successful agent start', fakeAsync(() => {
			const mockAgentId = 'test-agent-id-456';
			agentServiceMock.startAgent.and.returnValue(of({ agentId: mockAgentId } as AgentContextApi));

			component.onSubmit();
			tick(); // for async operations in finalize/subscribe

			expect(routerMock.navigate).toHaveBeenCalledWith(['/ui/agents', mockAgentId]);
			expect(snackBarMock.open).toHaveBeenCalledWith('Agent started', 'Close', { duration: 3000 });
		}));

		it('should show error snackbar on agentService.startAgent failure', fakeAsync(() => {
			const errorResponse = { message: 'Creation failed badly' };
			agentServiceMock.startAgent.and.returnValue(throwError(() => errorResponse));

			component.onSubmit();
			tick(); // for async operations in finalize/subscribe

			expect(snackBarMock.open).toHaveBeenCalledWith(`Error: ${errorResponse.message}`, 'Close', { duration: 3000 });
			expect(routerMock.navigate).not.toHaveBeenCalled();
		}));

		it('should set isSubmitting to true during submission and false on success', fakeAsync(() => {
			const agentStartSubject = new Subject<AgentContextApi>();
			agentServiceMock.startAgent.and.returnValue(agentStartSubject.asObservable());

			component.onSubmit();
			expect(component.isSubmitting).toBeTrue();

			agentStartSubject.next({ agentId: 'new-id' } as AgentContextApi);
			tick();
			fixture.detectChanges();
			expect(component.isSubmitting).toBeFalse();
		}));

		it('should set isSubmitting to true during submission and false on error', fakeAsync(() => {
			const agentStartSubject = new Subject<AgentContextApi>();
			agentServiceMock.startAgent.and.returnValue(agentStartSubject.asObservable());

			component.onSubmit();
			expect(component.isSubmitting).toBeTrue();

			agentStartSubject.error({ message: 'Failed' });
			tick();
			fixture.detectChanges();
			expect(component.isSubmitting).toBeFalse();
		}));
	});

	describe('effect for availableFunctionsState', () => {
		beforeEach(() => {
			// Reset signal to a known state before each test in this suite.
			mockAvailableFunctionsSignal.set({ status: 'idle' });
			// Reset spy call counts
			agentServiceMock.loadAvailableFunctions.calls.reset(); // Reset this as ngOnInit calls it
			snackBarMock.open.calls.reset();
			// Clear existing function form controls that might have been added by main beforeEach
			component.functions.forEach((_, index) => {
				component.runAgentForm.removeControl(`function${index}`);
			});
			component.functions = []; // Reset component's functions array
			fixture.detectChanges();
		});

		it('should call loadAvailableFunctions on init (covered by main describe, but good to be aware)', () => {
			// This is implicitly tested by the main `beforeEach` and `it('should initialize form...')`
			// Re-asserting here to ensure it's clear this is expected.
			// The component's ngOnInit calls this.agentService.loadAvailableFunctions();
			// The main `beforeEach` calls `fixture.detectChanges()` which triggers `ngOnInit`.
			// `loadAvailableFunctions` is reset in this suite's `beforeEach`,
			// so if we re-trigger ngOnInit or if it was called once already:
			// For this specific test, we can re-initialize the component to ensure ngOnInit is called in this context
			// However, the component is already created. The loadAvailableFunctions was called during the initial fixture.detectChanges().
			// So, we check if it was called at least once by the time this suite runs.
			expect(agentServiceMock.loadAvailableFunctions).toHaveBeenCalled();
		});

		it('should update functions and form controls on successful signal emission', fakeAsync(() => {
			// Arrange: ngOnInit has been called by the outer fixture.detectChanges().
			// The effect is set up. component.agentService.loadAvailableFunctions() was called.

			const newFunctions = ['TestFunc1', 'TestFunc2', 'GitHub']; // Include a Git function
			spyOn(component, 'updateSharedReposState').and.callThrough();

			// Act: Simulate successful data from signal
			mockAvailableFunctionsSignal.set({ status: 'success', data: newFunctions });
			tick(); // Allow microtasks and effect to run
			fixture.detectChanges(); // Reflect changes in the component

			// Assert
			expect(component.functions).toEqual(newFunctions.sort()); // Component sorts them
			expect(component.runAgentForm.get('function0')).toBeTruthy();
			expect(component.runAgentForm.get('function0')?.value).toBe(false); // Default to false
			expect(component.runAgentForm.get('function1')).toBeTruthy();
			expect(component.runAgentForm.get('function2')).toBeTruthy(); // For 'GitHub'

			// expect(component.updateSharedReposState).toHaveBeenCalled(); TODO dont verify interactions. verify state. Should be checking on the UI if the sharedRepos checkbox is enabled
		}));

		it('should handle error state from signal and show snackbar', fakeAsync(() => {
			// Arrange: ngOnInit has been called.
			const error = new Error('Failed to load functions');
			component.functions = []; // Ensure a known starting state for this assertion

			// Act: Simulate error data from signal
			mockAvailableFunctionsSignal.set({ status: 'error', error: error });
			tick();
			fixture.detectChanges();

			// Assert
			expect(snackBarMock.open).toHaveBeenCalledWith('Error fetching agent functions', 'Close', { duration: 3000 });
			expect(component.functions).toEqual([]); // Functions should remain empty
			expect(component.runAgentForm.get('function0')).toBeFalsy(); // Controls should not be added
		}));

		it('should not add duplicate form controls if effect runs multiple times with same functions', fakeAsync(() => {
			// Arrange: ngOnInit has been called.
			const initialFunctions = ['FuncA', 'FuncB'];
			mockAvailableFunctionsSignal.set({ status: 'success', data: initialFunctions });
			tick();
			fixture.detectChanges();

			// Initial check
			expect(component.runAgentForm.get('function0')).toBeTruthy();
			expect(component.runAgentForm.get('function1')).toBeTruthy();
			expect(component.runAgentForm.get('function2')).toBeFalsy(); // Control for a third func shouldn't exist

			// Act: Set signal again with the same data. The effect should re-run.
			mockAvailableFunctionsSignal.set({ status: 'success', data: initialFunctions });
			tick(); // Allow effect to run again
			fixture.detectChanges();

			// Assert: Controls should still be there, not duplicated.
			const formControls = component.runAgentForm.controls;
			const functionControlKeys = Object.keys(formControls).filter((key) => key.startsWith('function'));
			expect(functionControlKeys.length).toBe(initialFunctions.length);
			expect(formControls.function0).toBeTruthy();
			expect(formControls.function1).toBeTruthy();
		}));

		it('should clear existing function controls if new function list is empty', fakeAsync(() => {
			// Arrange: Populate with some functions first
			const initialFunctions = ['FuncX', 'FuncY'];
			mockAvailableFunctionsSignal.set({ status: 'success', data: initialFunctions });
			tick();
			fixture.detectChanges();
			expect(component.runAgentForm.get('function0')).toBeTruthy();
			expect(component.runAgentForm.get('function1')).toBeTruthy();

			// Act: Set signal with empty function list
			mockAvailableFunctionsSignal.set({ status: 'success', data: [] });
			tick();
			fixture.detectChanges();

			// Assert
			expect(component.functions).toEqual([]);
			expect(component.runAgentForm.get('function0')).toBeFalsy();
			expect(component.runAgentForm.get('function1')).toBeFalsy();
			const formControls = component.runAgentForm.controls;
			const functionControlKeys = Object.keys(formControls).filter((key) => key.startsWith('function'));
			expect(functionControlKeys.length).toBe(0);
		}));

		it('should update controls if function list changes (add/remove)', fakeAsync(() => {
			// Arrange: Populate with some functions first
			mockAvailableFunctionsSignal.set({ status: 'success', data: ['FuncA', 'FuncB'] });
			tick();
			fixture.detectChanges();
			expect(component.runAgentForm.get('function0')).toBeTruthy(); // FuncA
			expect(component.runAgentForm.get('function1')).toBeTruthy(); // FuncB
			expect(component.runAgentForm.get('function2')).toBeFalsy();

			// Act: Change function list - remove FuncB, add FuncC
			mockAvailableFunctionsSignal.set({ status: 'success', data: ['FuncA', 'FuncC'] });
			tick();
			fixture.detectChanges();

			// Assert: component.functions is sorted, so FuncA is 0, FuncC is 1
			expect(component.functions).toEqual(['FuncA', 'FuncC'].sort());
			expect(component.runAgentForm.get('function0')?.getRawValue()).toBeDefined(); // Should be FuncA's control
			expect(component.runAgentForm.get('function1')?.getRawValue()).toBeDefined(); // Should be FuncC's control

			// Check that the old FuncB control (which was function1) is gone,
			// and the new list has the correct number of controls.
			const formControls = component.runAgentForm.controls;
			const functionControlKeys = Object.keys(formControls).filter((key) => key.startsWith('function'));
			expect(functionControlKeys.length).toBe(2);
		}));
	});
});
