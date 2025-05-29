import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ReactiveFormsModule, FormArray } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from "@angular/material/card";
import { CommonModule, Location } from '@angular/common';
import { RouterTestingModule } from "@angular/router/testing";

import { CodeReviewEditComponent } from './code-review-edit.component';
import { CodeReviewServiceClient } from '../code-review.service';
import { CodeReviewConfig, IExample } from '#shared/codeReview/codeReview.model';
import { CodeReviewConfigCreate, CodeReviewConfigUpdate } from "#shared/codeReview/codeReview.schema";

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
  let mockLocation: jasmine.SpyObj<Location>;

  beforeEach(async () => {
    mockCodeReviewService = jasmine.createSpyObj('CodeReviewServiceClient', ['getCodeReviewConfig', 'createCodeReviewConfig', 'updateCodeReviewConfig']);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockLocation = jasmine.createSpyObj('Location', ['back']);

    mockActivatedRoute = {
      snapshot: {
        paramMap: jasmine.createSpyObj('paramMap', ['get'])
      }
    };
    (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue(null);


    await TestBed.configureTestingModule({
      imports: [
        CommonModule,
        ReactiveFormsModule,
        HttpClientTestingModule,
        NoopAnimationsModule,
        RouterTestingModule,
        MatFormFieldModule,
        MatInputModule,
        MatCheckboxModule,
        MatChipsModule,
        MatIconModule,
        MatButtonModule,
        MatProgressSpinnerModule,
        MatCardModule,
        CodeReviewEditComponent // Standalone component
      ],
      providers: [
        { provide: CodeReviewServiceClient, useValue: mockCodeReviewService },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: Router, useValue: mockRouter },
        { provide: Location, useValue: mockLocation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CodeReviewEditComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('Initialization (ngOnInit)', () => {
    it('should set pageTitle to "Create" and not load data if id is not present', () => {
      fixture.detectChanges(); // Triggers ngOnInit
      expect(component.pageTitle()).toBe('Create Code Review Configuration');
      expect(component.configId()).toBeNull();
      expect(mockCodeReviewService.getCodeReviewConfig).not.toHaveBeenCalled();
      expect(component.editForm().value.title).toEqual(''); // Default empty from initForm
    });

    it('should load config data, set form, and pageTitle to "Edit" if id is present', fakeAsync(() => {
      (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue('test-id-1');
      mockCodeReviewService.getCodeReviewConfig.and.returnValue(of(mockConfig));

      fixture.detectChanges(); // Triggers ngOnInit
      tick(); // for of(mockConfig)

      expect(component.configId()).toBe('test-id-1');
      expect(component.pageTitle()).toBe('Edit Code Review Configuration');
      expect(mockCodeReviewService.getCodeReviewConfig).toHaveBeenCalledWith('test-id-1');
      expect(component.isLoading()).toBeFalse();
      expect(component.editForm().value.title).toEqual(mockConfig.title);
      expect((component.editForm().get('examples') as FormArray).length).toBe(mockConfig.examples.length);
      expect(component.editForm().get('fileExtensions.include')?.value).toEqual(mockConfig.fileExtensions.include);
      expect(component.editForm().get('requires.text')?.value).toEqual(mockConfig.requires.text);
      expect(component.editForm().get('projectPaths')?.value).toEqual(mockConfig.projectPaths);
      expect(component.editForm().get('tags')?.value).toEqual(mockConfig.tags);
    }));

    it('should set error signal if loading config data fails', fakeAsync(() => {
      (mockActivatedRoute.snapshot.paramMap.get as jasmine.Spy).and.returnValue('test-id-1');
      mockCodeReviewService.getCodeReviewConfig.and.returnValue(throwError(() => new Error('Load failed')));

      fixture.detectChanges(); // ngOnInit
      tick(); // for throwError

      expect(component.isLoading()).toBeFalse();
      expect(component.error()).toBe('Error loading config data');
    }));
  });

  describe('Form Operations', () => {
    beforeEach(() => {
      fixture.detectChanges(); // ngOnInit
    });

    it('should add an example to the examples FormArray', () => {
      const examplesArray = component.editForm().get('examples') as FormArray;
      const initialCount = examplesArray.length;
      component.addExample();
      expect(examplesArray.length).toBe(initialCount + 1);
      expect(examplesArray.at(initialCount).get('code')?.value).toBe('');
    });

    it('should remove an example from the examples FormArray', () => {
      component.addExample(); // Add one
      component.addExample(); // Add another
      const examplesArray = component.editForm().get('examples') as FormArray;
      const initialCount = examplesArray.length;
      component.removeExample(0);
      expect(examplesArray.length).toBe(initialCount - 1);
    });

    it('should add a tag if value is provided and input is cleared', () => {
      const mockChipInputEvent = {
        value: ' new-tag ',
        input: { value: '' } as HTMLInputElement // Mock the input part of the event
      } as MatChipInputEvent;

      component.addTag(mockChipInputEvent);
      expect(component.editForm().get('tags')?.value).toContain('new-tag');
      expect(mockChipInputEvent.input.value).toBe(''); // Check input is cleared
    });

    it('should not add an empty tag', () => {
      const mockChipInputEvent = {
        value: '  ',
        input: { value: '' } as HTMLInputElement
      } as MatChipInputEvent;
      const initialTags = [...(component.editForm().get('tags')?.value || [])];
      component.addTag(mockChipInputEvent);
      expect(component.editForm().get('tags')?.value).toEqual(initialTags);
    });

    it('should remove a tag', () => {
      component.editForm().get('tags')?.setValue(['tag1', 'tag2']);
      fixture.detectChanges();
      component.removeTag('tag1');
      expect(component.editForm().get('tags')?.value).not.toContain('tag1');
      expect(component.editForm().get('tags')?.value).toContain('tag2');
    });
  });

  describe('Saving Config (onSubmit)', () => {
    beforeEach(() => {
      fixture.detectChanges(); // ngOnInit
      // Set up a valid form for create mode
      component.editForm().patchValue({
        title: 'New Config Title',
        enabled: true,
        description: 'New Desc',
      });
      component.editForm().get('fileExtensions.include')?.setValue(['.ts', '.js']);
      component.editForm().get('requires.text')?.setValue(['TODO', 'FIXME']);
      component.editForm().get('projectPaths')?.setValue(['/src/app']);
      component.editForm().get('tags')?.setValue(['new-tag']);
      component.addExample();
      (component.editForm().get('examples') as FormArray).at(0).patchValue({ code: 'test code', reviewComment: 'test comment' });
      fixture.detectChanges();
    });

    it('should call createCodeReviewConfig with correct payload for new config and navigate', fakeAsync(() => {
      mockCodeReviewService.createCodeReviewConfig.and.returnValue(of({ message: 'Created successfully' }));

      component.onSubmit();
      expect(component.isSaving()).toBeTrue();
      tick(); // For async operations

      expect(mockCodeReviewService.createCodeReviewConfig).toHaveBeenCalledTimes(1);
      const createdArg = mockCodeReviewService.createCodeReviewConfig.calls.first().args[0] as CodeReviewConfigCreate;

      expect(createdArg.title).toBe('New Config Title');
      expect(createdArg.fileExtensions.include).toEqual(['.ts', '.js']);
      expect(createdArg.requires.text).toEqual(['TODO', 'FIXME']);
      // ... other assertions for payload

      expect(component.isSaving()).toBeFalse();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/code-reviews']);
    }));

    it('should call updateCodeReviewConfig with correct payload for existing config and navigate', fakeAsync(() => {
      // Switch to edit mode
      component.configId.set('existing-id');
      // Simulate loading data for edit mode (or just set form values)
      component.editForm().patchValue({ title: 'Updated Title' });
      fixture.detectChanges();

      mockCodeReviewService.updateCodeReviewConfig.and.returnValue(of({ message: 'Updated successfully' }));

      component.onSubmit();
      expect(component.isSaving()).toBeTrue();
      tick();

      expect(mockCodeReviewService.updateCodeReviewConfig).toHaveBeenCalledTimes(1);
      const [updatedId, updatedArg] = mockCodeReviewService.updateCodeReviewConfig.calls.first().args;

      expect(updatedId).toBe('existing-id');
      expect((updatedArg as CodeReviewConfigUpdate).title).toBe('Updated Title');
      // ... other assertions

      expect(component.isSaving()).toBeFalse();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/code-reviews']);
    }));

    it('should set error signal if create fails', fakeAsync(() => {
      mockCodeReviewService.createCodeReviewConfig.and.returnValue(throwError(() => new Error('Create Save failed')));
      component.onSubmit();
      tick();

      expect(component.isSaving()).toBeFalse();
      expect(component.error()).toBe('Error saving configuration');
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    }));

    it('should set error signal if update fails', fakeAsync(() => {
      component.configId.set('existing-id');
      fixture.detectChanges();
      mockCodeReviewService.updateCodeReviewConfig.and.returnValue(throwError(() => new Error('Update Save failed')));
      component.onSubmit();
      tick();

      expect(component.isSaving()).toBeFalse();
      expect(component.error()).toBe('Error saving configuration');
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    }));

    it('should not save if form is invalid and markAllAsTouched', () => {
      component.editForm().get('title')?.setValue(''); // Make form invalid
      fixture.detectChanges();
      const markAllAsTouchedSpy = spyOn(component.editForm(), 'markAllAsTouched').and.callThrough();

      component.onSubmit();

      expect(markAllAsTouchedSpy).toHaveBeenCalled();
      expect(mockCodeReviewService.createCodeReviewConfig).not.toHaveBeenCalled();
      expect(mockCodeReviewService.updateCodeReviewConfig).not.toHaveBeenCalled();
      expect(component.isSaving()).toBeFalse();
    });
  });

  describe('goBack', () => {
    it('should call location.back()', () => {
      component.goBack();
      expect(mockLocation.back).toHaveBeenCalled();
    });
  });
});
