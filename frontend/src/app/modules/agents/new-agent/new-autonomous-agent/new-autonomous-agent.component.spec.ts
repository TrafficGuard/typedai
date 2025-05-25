import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'; // Added fakeAsync, tick
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'; // Added HttpTestingController
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar'; // Added MatSnackBar
import { NewAutonomousAgentComponent } from './new-autonomous-agent.component';
import { LlmService, LLM as LlmModel } from '../../../llm.service'; // Corrected LlmModel import
import { UserService } from 'app/core/user/user.service';
import { UserProfile } from "#shared/schemas/user.schema";
import { of, Subject, BehaviorSubject, throwError } from 'rxjs'; // Added Subject, BehaviorSubject, throwError
import { ReactiveFormsModule } from '@angular/forms'; // Added ReactiveFormsModule
import { MatSelectModule } from '@angular/material/select'; // Added MatSelectModule
import { MatFormFieldModule } from '@angular/material/form-field'; // Added MatFormFieldModule
import { MatInputModule } from '@angular/material/input'; // Added MatInputModule
import { MatCheckboxModule } from '@angular/material/checkbox'; // Added MatCheckboxModule
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // Added MatProgressSpinnerModule
import { AgentService, AgentStartRequestData } from '../../agent.service'; // Added AgentService and AgentStartRequestData
import { Router } from '@angular/router'; // Added Router
import { AgentContextApi } from '#shared/schemas/agent.schema'; // Added AgentContextApi


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
      createdAt: new Date(),
  };


  beforeEach(async () => {
    llmServiceMock = jasmine.createSpyObj('LlmService', ['getLlms']);
    llmServiceMock.getLlms.and.returnValue(of(mockLlms));

    userProfileSubject = new BehaviorSubject<UserProfile | null>(mockUserProfile);
    userServiceMock = jasmine.createSpyObj('UserService', ['get']);
    userServiceMock.get.and.returnValue(userProfileSubject.asObservable());

    agentServiceMock = jasmine.createSpyObj('AgentService', ['startAgent', 'getAvailableFunctions']);
    agentServiceMock.getAvailableFunctions.and.returnValue(of(mockFunctions)); // Mock for ngOnInit

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

    fixture.detectChanges(); // Trigger ngOnInit
    tick(); // Process async operations from ngOnInit (getAvailableFunctions)
    fixture.detectChanges();

    // agentService.getAvailableFunctions is mocked, so no httpMock for 'api/agent/v1/functions'

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
    expect(agentServiceMock.getAvailableFunctions).toHaveBeenCalled();
    expect(component.llms).toEqual(mockLlms);
    expect(component.functions).toEqual(mockFunctions.sort()); // component sorts them
    expect(userServiceMock.get).toHaveBeenCalled();

    // Check if function controls are added
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
    beforeEach(() => {
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
        useSharedRepos: true,
      });
      // Select one function to make the payload more complete
      if (component.functions.length > 0) {
        component.runAgentForm.get('function0')?.setValue(true);
      }
      fixture.detectChanges();
    });

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

      const expectedFunctions = component.functions
        .filter((_, index) => component.runAgentForm.value['function' + index])
        .map(tool => tool);

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
});
