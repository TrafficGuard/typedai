import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CodeTaskComponent } from './codeTask.component';
import { CodeTaskServiceClient } from './codeTask.service';
import { ActivatedRoute, Router, convertToParamMap, ParamMap } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject, throwError, Observable } from 'rxjs';
import { CodeTask } from '#shared/codeTask/codeTask.model';
import { HttpClientTestingModule } from '@angular/common/http/testing';

// Mocks
class MockCodeTaskServiceClient {
  getCodeTask = jasmine.createSpy('getCodeTask').and.returnValue(of({} as CodeTask));
  resetFileSelection = jasmine.createSpy('resetFileSelection').and.returnValue(of(undefined));
  // Add other methods if CodeTaskComponent starts using them
}

class MockMatSnackBar {
  open = jasmine.createSpy('open');
}

describe('CodeTaskComponent', () => {
  let component: CodeTaskComponent;
  let fixture: ComponentFixture<CodeTaskComponent>;
  let codeTaskService: MockCodeTaskServiceClient;
  let snackBar: MockMatSnackBar;
  let activatedRoute: ActivatedRoute;
  let router: Router;

  const testCodeTaskId = 'test-codeTask-id';
  const mockCodeTask: CodeTask = {
    id: testCodeTaskId,
    title: 'Test CodeTask',
    instructions: 'Test Instructions',
    status: 'file_selection_review',
    userId: 'test-user',
    repositorySource: 'local',
    repositoryId: '/path/to/repo',
    targetBranch: 'main',
    workingBranch: 'feat/test',
    // Initialize other CodeTask properties as needed for tests
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fileSelection: [],
    design: null,
    selectedVariations: null,
    codeDiff: null,
    codeTaskError: null,
  };

  // Subject to control paramMap emissions
  let paramMapSubject: Subject<ParamMap>;

  beforeEach(fakeAsync(() => {
    paramMapSubject = new Subject<ParamMap>();
    TestBed.configureTestingModule({
      imports: [
        CodeTaskComponent, // Import standalone component
        NoopAnimationsModule,
        HttpClientTestingModule,
      ],
      providers: [
        { provide: CodeTaskServiceClient, useClass: MockCodeTaskServiceClient },
        { provide: MatSnackBar, useClass: MockMatSnackBar },
        { provide: ActivatedRoute, useValue: { paramMap: paramMapSubject.asObservable() } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodeTaskComponent);
    component = fixture.componentInstance;
    codeTaskService = TestBed.inject(CodeTaskServiceClient) as unknown as MockCodeTaskServiceClient;
    snackBar = TestBed.inject(MatSnackBar) as unknown as MockMatSnackBar;
    activatedRoute = TestBed.inject(ActivatedRoute);
    router = TestBed.inject(Router);

    // Tick to allow component construction and initial DI to settle if needed
    tick();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should subscribe to route.paramMap and fetch codeTask data if codeTaskId is present', fakeAsync(() => {
      codeTaskService.getCodeTask.and.returnValue(of(mockCodeTask));

      paramMapSubject.next(convertToParamMap({ id: testCodeTaskId }));
      tick(); // Allow time for switchMap, service call, and tap operator

      expect(codeTaskService.getCodeTask).toHaveBeenCalledWith(testCodeTaskId);
      expect(component.currentCodeTask).toEqual(mockCodeTask);
    }));

    it('should log an error and not fetch codeTask if codeTaskId is missing', fakeAsync(() => {
      const consoleErrorSpy = spyOn(console, 'error');
      codeTaskService.getCodeTask.calls.reset(); // Reset spy calls
      component.currentCodeTask = null; // Reset current codeTask

      paramMapSubject.next(convertToParamMap({})); // No 'id' parameter
      tick();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Code Task ID not found in route parameters');
      expect(codeTaskService.getCodeTask).not.toHaveBeenCalled();
      expect(component.currentCodeTask).toBeNull();
    }));

    it('should update currentCodeTask when codeTask$ emits a new codeTask', fakeAsync(() => {
      const newMockCodeTask = { ...mockCodeTask, title: 'Updated CodeTask' };
      codeTaskService.getCodeTask.and.returnValue(of(newMockCodeTask));

      paramMapSubject.next(convertToParamMap({ id: testCodeTaskId }));
      tick();

      expect(component.currentCodeTask).toEqual(newMockCodeTask);
    }));

    it('should handle error from getCodeTask gracefully', fakeAsync(() => {
      const consoleErrorSpy = spyOn(console, 'error');
      codeTaskService.getCodeTask.and.returnValue(throwError(() => new Error('Fetch error')));
      component.currentCodeTask = null;

      paramMapSubject.next(convertToParamMap({ id: testCodeTaskId }));
      tick(); // Allow time for the error to propagate

      // The component's codeTask$ observable will complete or error.
      // currentCodeTask might remain null or its initial state depending on error handling in the tap.
      // The current implementation's tap only sets currentCodeTask on success.
      expect(component.currentCodeTask).toBeNull();
      // Check if error is logged by the observable pipeline if it has a catchError that logs.
      // The component itself doesn't explicitly catch errors from codeTask$ subscription in ngOnInit.
      // So, an unhandled error might propagate. For this test, we verify currentCodeTask state.
    }));
  });

  describe('handleSelectionResetRequested', () => {
    beforeEach(() => {
      // Set a valid currentCodeTask for most tests in this block
      component.currentCodeTask = { ...mockCodeTask };
      component.isProcessingAction = false; // Reset flag
      snackBar.open.calls.reset(); // Reset spy
      codeTaskService.resetFileSelection.calls.reset();
    });

    it('should not proceed and show snackbar if currentCodeTask is null', () => {
      component.currentCodeTask = null;
      component.handleSelectionResetRequested();

      expect(snackBar.open).toHaveBeenCalledWith('Error: CodeTask data not available.', 'Close', { duration: 3000 });
      expect(codeTaskService.resetFileSelection).not.toHaveBeenCalled();
    });

    it('should not proceed and show snackbar if an action is already in progress', () => {
      component.isProcessingAction = true;
      component.handleSelectionResetRequested();

      expect(snackBar.open).toHaveBeenCalledWith('Please wait, another action is in progress.', 'Close', { duration: 3000 });
      expect(codeTaskService.resetFileSelection).not.toHaveBeenCalled();
    });

    it('should call resetFileSelection, set processing flags, and show success snackbar on success', fakeAsync(() => {
      codeTaskService.resetFileSelection.and.returnValue(of(undefined));
      component.handleSelectionResetRequested();

      expect(component.isProcessingAction).toBeTrue();
      expect(codeTaskService.resetFileSelection).toHaveBeenCalledWith(testCodeTaskId);

      tick(); // For the observable from resetFileSelection to complete and finalize block

      expect(component.isProcessingAction).toBeFalse();
      expect(snackBar.open).toHaveBeenCalledWith('File selection reset successfully. CodeTask will refresh.', 'Close', { duration: 3500 });
    }));

    it('should handle error from resetFileSelection, unset processing flag, and show error snackbar', fakeAsync(() => {
      const errorResponse = { message: 'Reset failed miserably' };
      codeTaskService.resetFileSelection.and.returnValue(throwError(() => errorResponse));
      component.handleSelectionResetRequested();

      expect(component.isProcessingAction).toBeTrue();
      expect(codeTaskService.resetFileSelection).toHaveBeenCalledWith(testCodeTaskId);

      tick(); // For the observable to error and finalize block

      expect(component.isProcessingAction).toBeFalse();
      expect(snackBar.open).toHaveBeenCalledWith(`Error resetting file selection: ${errorResponse.message}`, 'Close', { duration: 5000 });
    }));
  });

  describe('ngOnDestroy', () => {
    it('should complete the destroy$ subject', () => {
      // Spy on the actual destroy$ subject in the component instance
      const destroyNextSpy = spyOn(component.destroy$, 'next').and.callThrough();
      const destroyCompleteSpy = spyOn(component.destroy$, 'complete').and.callThrough();

      fixture.destroy(); // This calls ngOnDestroy on the component

      expect(destroyNextSpy).toHaveBeenCalledBefore(destroyCompleteSpy);
      expect(destroyCompleteSpy).toHaveBeenCalled();
    });
  });
});
