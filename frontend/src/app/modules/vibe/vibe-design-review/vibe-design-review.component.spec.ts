import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ReactiveFormsModule } from '@angular/forms';
import { SimpleChange, ChangeDetectorRef } from '@angular/core'; // For testing ngOnChanges
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // Add this import
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { VibeDesignReviewComponent } from './vibe-design-review.component';
import { VibeServiceClient } from '../vibe-service-client.service';
import {VibeSession} from "#shared/model/vibe.model"; // Import the service


// Mock data
const mockSession: VibeSession = {
  userId: "",
  id: 'test-session-123',
  title: 'Test Session',
  instructions: 'Do the thing',
  repositorySource: 'local', // Assuming 'local' is a valid enum value
  repositoryId: '/test/repo',
  targetBranch: 'main',
  workingBranch: 'vibe/test-session-123',
  createWorkingBranch: true,
  useSharedRepos: false,
  status: 'design_review', // Updated status based on DOCS
  designAnswer: { // Assuming designAnswer is an object now based on VibeStatus changes
      summary: 'Initial design proposal text.',
      steps: ['Step 1', 'Step 2'],
      reasoning: 'Because reasons'
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastAgentActivity: Date.now(),
  error: null
  // Add other required fields if any
};
/*
// Mock VibeService
const mockVibeService = {
  updateDesignWithPrompt: jest.fn(),
  executeDesign: jest.fn(),
};

describe('VibeDesignReviewComponent', () => {
  let component: VibeDesignReviewComponent;
  let fixture: ComponentFixture<VibeDesignReviewComponent>;
  let router: Router;
  let snackBar: MatSnackBar;
  let cdr: ChangeDetectorRef;

  beforeEach(async () => {
    // Reset mocks before each test
    mockVibeService.updateDesignWithPrompt.mockReset().mockReturnValue(of(undefined));
    mockVibeService.executeDesign.mockReset().mockReturnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [
        VibeDesignReviewComponent,
        ReactiveFormsModule,
        HttpClientTestingModule, // Needed for services if not fully mocked
        RouterTestingModule.withRoutes([]), // Basic router setup
        MatSnackBarModule, // Needed for MatSnackBar
        MatProgressSpinnerModule, // Add this module here
      ],
      providers: [
        provideNoopAnimations(),
        { provide: VibeServiceClient, useValue: mockVibeService },
        // Provide ChangeDetectorRef - TestBed usually handles this for the component,
        // but if you need to inject it explicitly:
        // { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn() } } // Or get it from fixture
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(VibeDesignReviewComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router); // Inject Router
    snackBar = TestBed.inject(MatSnackBar); // Inject MatSnackBar
    cdr = fixture.debugElement.injector.get(ChangeDetectorRef); // Get instance associated with component

    // Set initial input
    component.session = { ...mockSession }; // Use a copy
    // fixture.detectChanges(); // Trigger ngOnInit and initial data binding - Moved to tests where needed
  });

  it('should create', () => {
    fixture.detectChanges(); // Needed for ngOnInit
    expect(component).toBeTruthy();
  });

  it('should initialize the form with session designAnswer', () => {
    fixture.detectChanges(); // Needed for ngOnInit
    expect(component.designForm).toBeDefined();
    // Variations control removed
    // expect(component.designForm.get('variations')).toBeNull();
    expect(component.designForm.get('designAnswer')?.value).toBe(mockSession.designAnswer.summary);
    expect(component.designForm.get('designAnswer')?.disabled).toBeTrue();
    expect(component.isEditing).toBeFalse();
    expect(component.refinementPrompt).toBeDefined();
    expect(component.refinementPrompt.value).toBe('');
  });

  it('should update the form when session input changes', () => {
    fixture.detectChanges(); // Initial detectChanges
    const newDesignText = 'Updated design text.';
    const newSession: VibeSession = { ...mockSession, designAnswer: { ...mockSession.designAnswer, summary: newDesignText } };

    // Simulate input change
    component.session = newSession;
    const previousSession = component.session; // Store old session reference if needed
    component.ngOnChanges({
        session: new SimpleChange(previousSession, newSession, false) // isFirstChange = false
    });
    fixture.detectChanges(); // Apply changes

    expect(component.designForm.get('designAnswer')?.value).toBe(newDesignText);

    // Test reset when editing
    component.isEditing = true; // Manually set to true
    component.designForm.get('designAnswer')?.enable(); // Enable control
    fixture.detectChanges();
    const newerSession = {...newSession, designAnswer: { ...newSession.designAnswer, summary: 'Another change' }};
    component.session = newerSession;
    component.ngOnChanges({
        session: new SimpleChange(newSession, newerSession, false)
    });
    fixture.detectChanges();
    expect(component.isEditing).toBeFalse(); // Should be reset
    expect(component.designForm.get('designAnswer')?.disabled).toBeTrue(); // Should be disabled after reset
    expect(component.designForm.get('designAnswer')?.value).toBe('Another change'); // Should reflect the latest session data
  });

  it('should toggle edit mode and enable/disable designAnswer control', () => {
    fixture.detectChanges(); // ngOnInit
    const designAnswerControl = component.designForm.get('designAnswer');

    expect(component.isEditing).toBeFalse();
    expect(designAnswerControl?.disabled).toBeTrue();

    component.toggleEdit();
    fixture.detectChanges();
    expect(component.isEditing).toBeTrue();
    expect(designAnswerControl?.enabled).toBeTrue();

    component.toggleEdit();
    fixture.detectChanges();
    expect(component.isEditing).toBeFalse();
    expect(designAnswerControl?.disabled).toBeTrue();
  });

  it('should cancel edit mode and revert designAnswer value', () => {
    fixture.detectChanges(); // ngOnInit
    const originalDesign = component.designForm.get('designAnswer')?.value;
    component.toggleEdit(); // Enter edit mode
    fixture.detectChanges();
    component.designForm.get('designAnswer')?.setValue('Temporary edit text');
    fixture.detectChanges();

    expect(component.isEditing).toBeTrue();
    expect(component.designForm.get('designAnswer')?.value).not.toBe(originalDesign);

    component.cancelEdit();
    fixture.detectChanges();

    expect(component.isEditing).toBeFalse();
    expect(component.designForm.get('designAnswer')?.value).toBe(originalDesign); // Value reverted
    expect(component.designForm.get('designAnswer')?.disabled).toBeTrue(); // Control disabled
  });

  it('should emit designSaved event with updated text on saveDesign()', () => {
    fixture.detectChanges(); // ngOnInit
    const emitSpy = jest.spyOn(component.designSaved, 'emit');
    const newDesignText = 'Saved design text.';

    component.toggleEdit(); // Enter edit mode
    fixture.detectChanges();
    component.designForm.get('designAnswer')?.setValue(newDesignText);
    fixture.detectChanges();

    component.saveDesign();
    fixture.detectChanges();

    expect(emitSpy).toHaveBeenCalledWith(newDesignText);
    expect(component.isEditing).toBeFalse(); // Should exit edit mode
    expect(component.designForm.get('designAnswer')?.disabled).toBeTrue(); // Control disabled
  });

  it('should not emit designSaved event if form is invalid or not editing', () => {
    fixture.detectChanges(); // ngOnInit
    const emitSpy = jest.spyOn(component.designSaved, 'emit');

    // Case 1: Not editing
    component.designForm.get('designAnswer')?.setValue('Some text');
    component.saveDesign();
    expect(emitSpy).not.toHaveBeenCalled();

    // Case 2: Editing but invalid (e.g., required field empty)
    component.toggleEdit();
    fixture.detectChanges();
    component.designForm.get('designAnswer')?.setValue(''); // Make invalid
    fixture.detectChanges();
    expect(component.designForm.invalid).toBeTrue();
    component.saveDesign();
    expect(emitSpy).not.toHaveBeenCalled();

    emitSpy.mockClear();
  });

  // Tests for submitRefinementPrompt
  describe('submitRefinementPrompt', () => {
    beforeEach(() => {
        fixture.detectChanges(); // Ensure component is initialized
    });

    it('should not call service if prompt is empty or whitespace', () => {
      component.refinementPrompt.setValue('');
      component.submitRefinementPrompt();
      expect(mockVibeService.updateDesignWithPrompt).not.toHaveBeenCalled();

      component.refinementPrompt.setValue('   ');
      component.submitRefinementPrompt();
      expect(mockVibeService.updateDesignWithPrompt).not.toHaveBeenCalled();
    });

    it('should call vibeService.updateDesignWithPrompt with correct args and handle loading state', fakeAsync(() => {
      const promptText = 'Refine this design';
      component.refinementPrompt.setValue(promptText);
      fixture.detectChanges();

      component.submitRefinementPrompt();

      expect(component.isLoading).toBe(true);
      expect(mockVibeService.updateDesignWithPrompt).toHaveBeenCalledWith(mockSession.id, promptText);

      tick(); // Allow observable to complete
      fixture.detectChanges();

      expect(component.isLoading).toBe(false);
    }));

    it('should show success snackbar and reset prompt on successful submission', fakeAsync(() => {
      const snackBarSpy = jest.spyOn(snackBar, 'open');
      component.refinementPrompt.setValue('Do it');
      fixture.detectChanges();

      component.submitRefinementPrompt();
      tick(); // Complete async operation
      fixture.detectChanges();

      // expect(snackBarSpy).toHaveBeenCalledWith('Refinement request submitted.', 'Close', expect.any(Object));
      expect(component.refinementPrompt.value).toBe('');
    }));

    it('should show error snackbar on failed submission', fakeAsync(() => {
      const error = new Error('Failed to submit');
      mockVibeService.updateDesignWithPrompt.mockReturnValue(throwError(() => error));
      const snackBarSpy = jest.spyOn(snackBar, 'open');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console error

      component.refinementPrompt.setValue('Do it');
      fixture.detectChanges();

      component.submitRefinementPrompt();
      tick(); // Complete async operation
      fixture.detectChanges();

      // expect(snackBarSpy).toHaveBeenCalledWith(error.message, 'Close', expect.any(Object));
      expect(consoleSpy).toHaveBeenCalledWith('Error submitting refinement prompt:', error);
      consoleSpy.mockRestore();
    }));
  });

  // Tests for triggerImplementation (called by acceptDesign)
  describe('triggerImplementation / acceptDesign', () => {
     beforeEach(() => {
        fixture.detectChanges(); // Ensure component is initialized
        component.isEditing = false; // Ensure not in edit mode
        component.designForm.get('designAnswer')?.disable();
        fixture.detectChanges();
    });

    it('should call triggerImplementation when acceptDesign is called and not editing', () => {
        const triggerSpy = jest.spyOn(component, 'triggerImplementation');
        component.acceptDesign();
        expect(triggerSpy).toHaveBeenCalled();
    });

    it('should not call triggerImplementation if editing', () => {
        const triggerSpy = jest.spyOn(component, 'triggerImplementation');
        component.toggleEdit(); // Enter edit mode
        fixture.detectChanges();
        component.acceptDesign();
        expect(triggerSpy).not.toHaveBeenCalled();
    });

    it('should call vibeService.executeDesign and handle loading state', fakeAsync(() => {
      component.acceptDesign(); // This calls triggerImplementation

      expect(component.isLoading).toBe(true);
      expect(mockVibeService.executeDesign).toHaveBeenCalledWith(mockSession.id);

      tick(); // Allow observable to complete
      fixture.detectChanges();

      expect(component.isLoading).toBe(false);
    }));

    it('should navigate and show success snackbar on successful execution', fakeAsync(() => {
      const snackBarSpy = jest.spyOn(snackBar, 'open');
      const routerSpy = jest.spyOn(router, 'navigate');

      component.acceptDesign();
      tick(); // Complete async operation
      fixture.detectChanges();

      expect(routerSpy).toHaveBeenCalledWith(['/vibe', 'coding', mockSession.id]);
      // expect(snackBarSpy).toHaveBeenCalledWith('Design accepted. Starting implementation...', 'Close', expect.any(Object));
    }));

    it('should show error snackbar on failed execution', fakeAsync(() => {
      const error = new Error('Execution failed');
      mockVibeService.executeDesign.mockReturnValue(throwError(() => error));
      const snackBarSpy = jest.spyOn(snackBar, 'open');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console error

      component.acceptDesign();
      tick(); // Complete async operation
      fixture.detectChanges();

      // expect(snackBarSpy).toHaveBeenCalledWith(error.message, 'Close', expect.any(Object));
      expect(consoleSpy).toHaveBeenCalledWith('Error executing design:', error);
      consoleSpy.mockRestore();
    }));
  });

  describe('Loading Overlay', () => {
    it('should display loading overlay when isLoading is true', () => {
      component.isLoading = true;
      fixture.detectChanges(); // Trigger change detection

      const overlayElement = fixture.debugElement.nativeElement.querySelector('.loading-overlay');
      expect(overlayElement).toBeTruthy(); // Check if the overlay element exists
    });

    it('should not display loading overlay when isLoading is false', () => {
      component.isLoading = false;
      fixture.detectChanges(); // Trigger change detection

      const overlayElement = fixture.debugElement.nativeElement.querySelector('.loading-overlay');
      expect(overlayElement).toBeFalsy(); // Check if the overlay element does not exist
    });
  });
});
*/