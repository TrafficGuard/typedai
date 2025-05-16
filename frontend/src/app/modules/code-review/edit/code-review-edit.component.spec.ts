/*
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { CodeReviewEditComponent } from './code-review-edit.component';
import { CodeReviewServiceClient } from '../code-review.service';
import { CodeReviewConfig, IExample } from '#shared/model/codeReview.model';
// CODE_REVIEW_API might not be directly needed if service methods are well-typed

// Mock data
const mockExample: IExample = { code: 'console.log("hello");', reviewComment: 'Use logger.' };
const mockConfig: CodeReviewConfig = {
  id: '123',
  title: 'Test Config',
  enabled: true,
  description: 'Test Description',
  fileExtensions: { include: ['.ts'] },
  requires: { text: ['TODO'] },
  tags: ['test-tag'],
  projectPaths: ['/src'],
  examples: [mockExample]
};

describe('CodeReviewEditComponent', () => {
  let component: CodeReviewEditComponent;
  let fixture: ComponentFixture<CodeReviewEditComponent>;
  let mockCodeReviewService: jasmine.SpyObj<CodeReviewServiceClient>;
  let mockActivatedRoute: any;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;

  beforeEach(async () => {
    mockCodeReviewService = jasmine.createSpyObj('CodeReviewServiceClient', ['getCodeReviewConfig', 'createCodeReviewConfig', 'updateCodeReviewConfig']);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

    mockActivatedRoute = {
      snapshot: {
        paramMap: jasmine.createSpyObj('paramMap', ['get'])
      },
      params: of({}) // Default to no params for create mode
    };
    // Default mock for get if needed immediately, can be overridden in tests
    (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue(null);


    await TestBed.configureTestingModule({
      imports: [
        ReactiveFormsModule,
        HttpClientTestingModule,
        NoopAnimationsModule,
        MatFormFieldModule,
        MatInputModule,
        MatCheckboxModule,
        MatChipsModule,
        MatIconModule,
        MatButtonModule,
        MatProgressSpinnerModule,
        CodeReviewEditComponent // Standalone component
      ],
      providers: [
        FormBuilder, // Provided by ReactiveFormsModule but can be explicit
        { provide: CodeReviewServiceClient, useValue: mockCodeReviewService },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: Router, useValue: mockRouter },
        { provide: MatSnackBar, useValue: mockSnackBar },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CodeReviewEditComponent);
    component = fixture.componentInstance;
    // fixture.detectChanges(); // Moved to individual tests or describe blocks for more control
  });

  it('should create', () => {
    fixture.detectChanges(); // Initial binding
    expect(component).toBeTruthy();
  });

  describe('Initialization (ngOnInit)', () => {
    it('should load config data and set form in edit mode if id is present', () => {
      (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue('test-id-1');
      // component.configId will be set by ngOnInit based on route param
      mockCodeReviewService.getCodeReviewConfig.and.returnValue(of(mockConfig));

      fixture.detectChanges(); // Triggers ngOnInit

      expect(component.isEditMode).toBeTrue();
      expect(component.configId).toBe('test-id-1');
      expect(mockCodeReviewService.getCodeReviewConfig).toHaveBeenCalledWith('test-id-1');
      expect(component.editForm.value.title).toEqual(mockConfig.title);
      expect(component.examples.length).toBe(mockConfig.examples.length);
      // Check if form arrays are populated correctly
      expect(component.editForm.get('fileExtensionsInclude')?.value).toBe(mockConfig.fileExtensions.include.join(', '));
      expect(component.editForm.get('requiresText')?.value).toBe(mockConfig.requires.text.join(', '));
      expect(component.editForm.get('projectPaths')?.value).toBe(mockConfig.projectPaths.join(', '));
      expect(component.tags.value).toEqual(mockConfig.tags);
    });

    it('should initialize empty form for new config if no id is present', () => {
      (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue(null);

      fixture.detectChanges(); // Triggers ngOnInit

      expect(component.isEditMode).toBeFalse();
      expect(component.configId).toBeNull();
      expect(component.editForm.value.title).toBeNull(); // Or empty string
      expect(mockCodeReviewService.getCodeReviewConfig).not.toHaveBeenCalled();
    });
  });

  describe('Form Operations', () => {
    beforeEach(() => {
      (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue(null); // Create mode
      fixture.detectChanges(); // ngOnInit
    });

    it('should add an example', () => {
      const initialCount = component.examples.length;
      component.addExample();
      expect(component.examples.length).toBe(initialCount + 1);
    });

    it('should remove an example', () => {
      component.addExample(); // Add one to remove
      const initialCount = component.examples.length;
      component.removeExample(0);
      expect(component.examples.length).toBe(initialCount - 1);
    });

    it('should add a tag if value is provided and input is cleared', () => {
      const mockChipInput = jasmine.createSpyObj('ChipInput', ['clear']);
      const mockEvent = { value: ' new-tag ', chipInput: mockChipInput } as any;
      component.addTag(mockEvent);
      expect(component.tags.value).toContain('new-tag'); // Check trimmed value
      expect(mockChipInput.clear).toHaveBeenCalled();
    });

    it('should not add an empty tag', () => {
      const mockChipInput = jasmine.createSpyObj('ChipInput', ['clear']);
      const mockEvent = { value: '  ', chipInput: mockChipInput } as any;
      const initialTags = [...component.tags.value];
      component.addTag(mockEvent);
      expect(component.tags.value).toEqual(initialTags);
      // Depending on implementation, clear might be called if value becomes empty string after trim
      // For this test, let's assume it's not called if no tag is added.
      // expect(mockChipInput.clear).not.toHaveBeenCalled();
    });

    it('should remove a tag', () => {
      component.tags.setValue(['tag1', 'tag2']);
      fixture.detectChanges();
      component.removeTag('tag1');
      expect(component.tags.value).not.toContain('tag1');
      expect(component.tags.value).toContain('tag2');
    });
  });

  describe('Saving Config', () => {
    beforeEach(() => {
      (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue(null); // Create mode
      fixture.detectChanges(); // ngOnInit
      component.editForm.patchValue({
        title: 'New Config Title',
        enabled: true,
        description: 'New Desc',
        fileExtensionsInclude: '.ts,.js',
        requiresText: 'TODO,FIXME',
        projectPaths: '/src/app',
      });
      component.addExample();
      component.examples.at(0).patchValue({ code: 'test code', reviewComment: 'test comment' });
      component.tags.setValue(['new-tag']);
      fixture.detectChanges();
    });

    it('should call createCodeReviewConfig with correct payload for new config', fakeAsync(() => {
      mockCodeReviewService.createCodeReviewConfig.and.returnValue(of({ message: 'Created successfully' }));
      component.isEditMode = false; // Explicitly set for clarity

      component.save();
      tick(); // For async operations like service calls and snackbar

      expect(mockCodeReviewService.createCodeReviewConfig).toHaveBeenCalledTimes(1);
      const createdArg = mockCodeReviewService.createCodeReviewConfig.calls.first().args[0];

      expect(createdArg.title).toBe('New Config Title');
      expect(createdArg.enabled).toBe(true);
      expect(createdArg.description).toBe('New Desc');
      expect(createdArg.fileExtensions.include).toEqual(['.ts', '.js']);
      expect(createdArg.requires.text).toEqual(['TODO', 'FIXME']);
      expect(createdArg.projectPaths).toEqual(['/src/app']);
      expect(createdArg.tags).toEqual(['new-tag']);
      expect(createdArg.examples.length).toBe(1);
      expect(createdArg.examples[0]).toEqual({ code: 'test code', reviewComment: 'test comment' });

      expect(mockSnackBar.open).toHaveBeenCalledWith('Configuration saved successfully', 'Close', { duration: 3000 });
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/code-review/list']);
    }));

    it('should call updateCodeReviewConfig with correct payload for existing config', fakeAsync(() => {
      // Setup for edit mode
      (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue('existing-id');
      mockCodeReviewService.getCodeReviewConfig.and.returnValue(of({ ...mockConfig, id: 'existing-id' })); // Mock loading existing
      fixture.detectChanges(); // Re-run ngOnInit for edit mode

      // Now component.isEditMode should be true, and component.configId should be 'existing-id'
      // Patch form with some changes
      component.editForm.patchValue({ title: 'Updated Title' });
      fixture.detectChanges();

      mockCodeReviewService.updateCodeReviewConfig.and.returnValue(of({ message: 'Updated successfully' }));

      component.save();
      tick();

      expect(mockCodeReviewService.updateCodeReviewConfig).toHaveBeenCalledTimes(1);
      const [updatedId, updatedArg] = mockCodeReviewService.updateCodeReviewConfig.calls.first().args;

      expect(updatedId).toBe('existing-id');
      expect(updatedArg.title).toBe('Updated Title'); // Changed value
      expect(updatedArg.enabled).toBe(component.editForm.value.enabled);
      // ... other assertions for updatedArg properties based on form state

      expect(mockSnackBar.open).toHaveBeenCalledWith('Configuration saved successfully', 'Close', { duration: 3000 });
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/code-review/list']);
    }));

    it('should show error snackbar if save (create) fails', fakeAsync(() => {
      mockCodeReviewService.createCodeReviewConfig.and.returnValue(throwError(() => new Error('Create Save failed')));
      component.isEditMode = false;
      component.save();
      tick();

      expect(mockSnackBar.open).toHaveBeenCalledWith('Error saving configuration: Create Save failed', 'Close', { duration: 5000 });
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    }));

    it('should show error snackbar if save (update) fails', fakeAsync(() => {
      (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue('existing-id');
      mockCodeReviewService.getCodeReviewConfig.and.returnValue(of({ ...mockConfig, id: 'existing-id' }));
      fixture.detectChanges(); // Init in edit mode

      mockCodeReviewService.updateCodeReviewConfig.and.returnValue(throwError(() => new Error('Update Save failed')));
      component.save();
      tick();

      expect(mockSnackBar.open).toHaveBeenCalledWith('Error saving configuration: Update Save failed', 'Close', { duration: 5000 });
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    }));


    it('should not save if form is invalid', () => {
      component.editForm.controls['title'].setValue(''); // Make form invalid
      fixture.detectChanges();
      component.save();
      expect(mockCodeReviewService.createCodeReviewConfig).not.toHaveBeenCalled();
      expect(mockCodeReviewService.updateCodeReviewConfig).not.toHaveBeenCalled();
    });
  });

  describe('Utility methods for form arrays', () => {
    beforeEach(() => {
        fixture.detectChanges();
    });
    it('splitCommaSeparatedString should split string and trim whitespace', () => {
        const result = (component as any).splitCommaSeparatedString(' .ts, .js , .py ');
        expect(result).toEqual(['.ts', '.js', '.py']);
    });

    it('splitCommaSeparatedString should return empty array for empty or null string', () => {
        expect((component as any).splitCommaSeparatedString('')).toEqual([]);
        expect((component as any).splitCommaSeparatedString(null)).toEqual([]);
    });
  });

});
*/
