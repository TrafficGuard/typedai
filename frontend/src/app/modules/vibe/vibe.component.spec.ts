import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { VibeComponent } from './vibe.component';
import { VibeServiceClient } from './vibe-service-client.service';
import { ActivatedRoute, Router, convertToParamMap, ParamMap } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject, throwError, Observable } from 'rxjs';
import { VibeSession } from '#shared/model/vibe.model';
import { HttpClientTestingModule } from '@angular/common/http/testing';

// Mocks
class MockVibeServiceClient {
  getVibeSession = jasmine.createSpy('getVibeSession').and.returnValue(of({} as VibeSession));
  resetFileSelection = jasmine.createSpy('resetFileSelection').and.returnValue(of(undefined));
  // Add other methods if VibeComponent starts using them
}

class MockMatSnackBar {
  open = jasmine.createSpy('open');
}

describe('VibeComponent', () => {
  let component: VibeComponent;
  let fixture: ComponentFixture<VibeComponent>;
  let vibeService: MockVibeServiceClient;
  let snackBar: MockMatSnackBar;
  let activatedRoute: ActivatedRoute;
  let router: Router;

  const testSessionId = 'test-session-id';
  const mockVibeSession: VibeSession = {
    id: testSessionId,
    title: 'Test Session',
    instructions: 'Test Instructions',
    status: 'file_selection_review',
    userId: 'test-user',
    repositorySource: 'local',
    repositoryId: '/path/to/repo',
    targetBranch: 'main',
    workingBranch: 'feat/test',
    // Initialize other VibeSession properties as needed for tests
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fileSelection: [],
    designAnswer: null,
    selectedVariations: null,
    codeDiff: null,
    sessionError: null,
  };

  // Subject to control paramMap emissions
  let paramMapSubject: Subject<ParamMap>;

  beforeEach(fakeAsync(() => {
    paramMapSubject = new Subject<ParamMap>();
    TestBed.configureTestingModule({
      imports: [
        VibeComponent, // Import standalone component
        NoopAnimationsModule,
        HttpClientTestingModule,
      ],
      providers: [
        { provide: VibeServiceClient, useClass: MockVibeServiceClient },
        { provide: MatSnackBar, useClass: MockMatSnackBar },
        { provide: ActivatedRoute, useValue: { paramMap: paramMapSubject.asObservable() } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(VibeComponent);
    component = fixture.componentInstance;
    vibeService = TestBed.inject(VibeServiceClient) as unknown as MockVibeServiceClient;
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
    it('should subscribe to route.paramMap and fetch session data if sessionId is present', fakeAsync(() => {
      vibeService.getVibeSession.and.returnValue(of(mockVibeSession));
      
      paramMapSubject.next(convertToParamMap({ id: testSessionId }));
      tick(); // Allow time for switchMap, service call, and tap operator

      expect(vibeService.getVibeSession).toHaveBeenCalledWith(testSessionId);
      expect(component.currentSession).toEqual(mockVibeSession);
    }));

    it('should log an error and not fetch session if sessionId is missing', fakeAsync(() => {
      const consoleErrorSpy = spyOn(console, 'error');
      vibeService.getVibeSession.calls.reset(); // Reset spy calls
      component.currentSession = null; // Reset current session

      paramMapSubject.next(convertToParamMap({})); // No 'id' parameter
      tick();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Vibe Session ID not found in route parameters');
      expect(vibeService.getVibeSession).not.toHaveBeenCalled();
      expect(component.currentSession).toBeNull();
    }));

    it('should update currentSession when session$ emits a new session', fakeAsync(() => {
      const newMockSession = { ...mockVibeSession, title: 'Updated Session' };
      vibeService.getVibeSession.and.returnValue(of(newMockSession));
      
      paramMapSubject.next(convertToParamMap({ id: testSessionId }));
      tick();

      expect(component.currentSession).toEqual(newMockSession);
    }));

    it('should handle error from getVibeSession gracefully', fakeAsync(() => {
      const consoleErrorSpy = spyOn(console, 'error');
      vibeService.getVibeSession.and.returnValue(throwError(() => new Error('Fetch error')));
      component.currentSession = null;

      paramMapSubject.next(convertToParamMap({ id: testSessionId }));
      tick(); // Allow time for the error to propagate

      // The component's session$ observable will complete or error.
      // currentSession might remain null or its initial state depending on error handling in the tap.
      // The current implementation's tap only sets currentSession on success.
      expect(component.currentSession).toBeNull();
      // Check if error is logged by the observable pipeline if it has a catchError that logs.
      // The component itself doesn't explicitly catch errors from session$ subscription in ngOnInit.
      // So, an unhandled error might propagate. For this test, we verify currentSession state.
    }));
  });

  describe('handleSelectionResetRequested', () => {
    beforeEach(() => {
      // Set a valid currentSession for most tests in this block
      component.currentSession = { ...mockVibeSession };
      component.isProcessingAction = false; // Reset flag
      snackBar.open.calls.reset(); // Reset spy
      vibeService.resetFileSelection.calls.reset();
    });

    it('should not proceed and show snackbar if currentSession is null', () => {
      component.currentSession = null;
      component.handleSelectionResetRequested();
      
      expect(snackBar.open).toHaveBeenCalledWith('Error: Session data not available.', 'Close', { duration: 3000 });
      expect(vibeService.resetFileSelection).not.toHaveBeenCalled();
    });

    it('should not proceed and show snackbar if an action is already in progress', () => {
      component.isProcessingAction = true;
      component.handleSelectionResetRequested();

      expect(snackBar.open).toHaveBeenCalledWith('Please wait, another action is in progress.', 'Close', { duration: 3000 });
      expect(vibeService.resetFileSelection).not.toHaveBeenCalled();
    });

    it('should call resetFileSelection, set processing flags, and show success snackbar on success', fakeAsync(() => {
      vibeService.resetFileSelection.and.returnValue(of(undefined));
      component.handleSelectionResetRequested();

      expect(component.isProcessingAction).toBeTrue();
      expect(vibeService.resetFileSelection).toHaveBeenCalledWith(testSessionId);
      
      tick(); // For the observable from resetFileSelection to complete and finalize block

      expect(component.isProcessingAction).toBeFalse();
      expect(snackBar.open).toHaveBeenCalledWith('File selection reset successfully. Session will refresh.', 'Close', { duration: 3500 });
    }));

    it('should handle error from resetFileSelection, unset processing flag, and show error snackbar', fakeAsync(() => {
      const errorResponse = { message: 'Reset failed miserably' };
      vibeService.resetFileSelection.and.returnValue(throwError(() => errorResponse));
      component.handleSelectionResetRequested();

      expect(component.isProcessingAction).toBeTrue();
      expect(vibeService.resetFileSelection).toHaveBeenCalledWith(testSessionId);

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
