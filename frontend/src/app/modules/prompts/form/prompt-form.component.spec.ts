import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormBuilder, ReactiveFormsModule, FormArray } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Location, CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, WritableSignal, ChangeDetectorRef } from '@angular/core';
import { of, throwError, Subject } from 'rxjs';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';


import { PromptFormComponent } from './prompt-form.component';
import { PromptsService } from '../prompts.service';
import type { Prompt } from '#shared/model/prompts.model';
import type { PromptSchemaModel } from '#shared/schemas/prompts.schema';

const mockPrompt: Prompt = {
  id: 'test-prompt-123',
  userId: 'user-1',
  revisionId: 1,
  name: 'Test Prompt',
  tags: ['test', 'sample'],
  messages: [
    { role: 'user', content: 'Hello there' },
    { role: 'assistant', content: 'Hi user!' }
  ],
  options: { temperature: 0.7, maxTokens: 100 },
  updatedAt: Date.now()
};
const mockPromptSchema = mockPrompt as PromptSchemaModel;


describe('PromptFormComponent', () => {
  let component: PromptFormComponent;
  let fixture: ComponentFixture<PromptFormComponent>;
  let mockPromptsService: jasmine.SpyObj<PromptsService>;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockLocation: jasmine.SpyObj<Location>;
  let mockActivatedRoute: any;
  let cdr: ChangeDetectorRef;


  beforeEach(async () => {
    mockPromptsService = jasmine.createSpyObj('PromptsService', [
      'createPrompt',
      'updatePrompt',
      'getPromptById',
      'clearSelectedPrompt',
    ]);
    // Mock the selectedPrompt signal if it's directly accessed by the component
    // For this component, it primarily relies on route.data for initial load.
    // (mockPromptsService as any).selectedPrompt = signal<Prompt | null>(null);


    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockLocation = jasmine.createSpyObj('Location', ['back']);

    mockActivatedRoute = {
      snapshot: {
        paramMap: convertToParamMap({}),
        data: {}
      },
      data: of({})
    };

    await TestBed.configureTestingModule({
      imports: [
        PromptFormComponent,
        ReactiveFormsModule,
        NoopAnimationsModule,
        CommonModule,
        MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule,
        MatChipsModule, MatProgressSpinnerModule, MatCardModule, MatSelectModule, MatTooltipModule
      ],
      providers: [
        FormBuilder,
        { provide: PromptsService, useValue: mockPromptsService },
        { provide: Router, useValue: mockRouter },
        { provide: Location, useValue: mockLocation },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PromptFormComponent);
    component = fixture.componentInstance;
    cdr = fixture.debugElement.injector.get(ChangeDetectorRef);
  });

  it('should create', () => {
    mockActivatedRoute.data = of({ prompt: null }); // Ensure ngOnInit runs without error
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('New Mode', () => {
    beforeEach(() => {
      mockActivatedRoute.data = of({ prompt: null });
      mockActivatedRoute.snapshot.paramMap = convertToParamMap({});
      fixture.detectChanges(); // ngOnInit
    });

    it('should initialize form for new prompt', fakeAsync(() => {
      tick(); // Allow microtasks from signal updates in ngOnInit to complete
      fixture.detectChanges();
      expect(component.isEditMode()).toBeFalse();
      expect(component.promptForm).toBeDefined();
      expect(component.promptForm.get('name')?.value).toBe('');
      expect(component.messagesFormArray.length).toBe(1);
      expect(component.messagesFormArray.at(0).get('role')?.value).toBe('user');
      expect(component.isLoading()).toBeFalse();
    }));

    it('should call promptsService.clearSelectedPrompt', fakeAsync(() => {
      tick();
      fixture.detectChanges();
      expect(mockPromptsService.clearSelectedPrompt).toHaveBeenCalled();
    }));

    it('onSubmit should call promptsService.createPrompt with correct payload', fakeAsync(() => {
      tick(); fixture.detectChanges(); // Initial tick for ngOnInit
      mockPromptsService.createPrompt.and.returnValue(of(mockPromptSchema));
      component.promptForm.patchValue({
        name: 'New Prompt Name',
        options: { temperature: 0.5, maxTokens: 500 }
      });
      component.messagesFormArray.at(0).patchValue({ role: 'user', content: 'User message' });
      component.tagsFormArray.push(new FormBuilder().control('newTag'));
      fixture.detectChanges();

      component.onSubmit();
      tick(); // For async operations in submit if any

      expect(mockPromptsService.createPrompt).toHaveBeenCalledWith(jasmine.objectContaining({
        name: 'New Prompt Name',
        messages: [{ role: 'user', content: 'User message' }],
        tags: ['newTag'],
        options: { temperature: 0.5, maxTokens: 500 }
      }));
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/prompts']);
    }));
  });

  describe('Edit Mode', () => {
     beforeEach(() => {
         mockActivatedRoute.data = of({ prompt: mockPrompt });
         mockActivatedRoute.snapshot.paramMap = convertToParamMap({ promptId: mockPrompt.id });
         fixture.detectChanges(); // ngOnInit
     });

     it('should initialize form for edit prompt and call populateForm', fakeAsync(() => {
         tick(); fixture.detectChanges();
         expect(component.isEditMode()).toBeTrue();
         expect(component.promptIdSignal()).toBe(mockPrompt.id);
         expect(component.promptForm.get('name')?.value).toBe(mockPrompt.name);
         expect(component.messagesFormArray.length).toBe(mockPrompt.messages.length);
         expect(component.tagsFormArray.length).toBe(mockPrompt.tags.length);
         expect(component.isLoading()).toBeFalse();
     }));

     it('onSubmit should call promptsService.updatePrompt with correct payload', fakeAsync(() => {
         tick(); fixture.detectChanges();
         mockPromptsService.updatePrompt.and.returnValue(of(mockPromptSchema));
         const updatedName = 'Updated Prompt Name';
         component.promptForm.get('name')?.setValue(updatedName);
         fixture.detectChanges();

         component.onSubmit();
         tick();

         expect(mockPromptsService.updatePrompt).toHaveBeenCalledWith(mockPrompt.id, jasmine.objectContaining({
             name: updatedName
         }));
         expect(mockRouter.navigate).toHaveBeenCalledWith(['/prompts']);
     }));

     it('should navigate if promptId in params but resolver returns null', fakeAsync(() => {
         mockActivatedRoute.data = of({ prompt: null });
         mockActivatedRoute.snapshot.paramMap = convertToParamMap({ promptId: 'some-id-that-failed' });
         spyOn(console, 'error');
         fixture.detectChanges(); // ngOnInit
         tick();
         fixture.detectChanges();

         expect(console.error).toHaveBeenCalledWith('Prompt not found for editing, navigating back.');
         expect(mockRouter.navigate).toHaveBeenCalledWith(['/prompts']);
     }));
  });


  it('should add and remove messages from FormArray', fakeAsync(() => {
    mockActivatedRoute.data = of({ prompt: null });
    fixture.detectChanges(); tick(); fixture.detectChanges();

    component.addMessage('system', 'System message');
    fixture.detectChanges();
    expect(component.messagesFormArray.length).toBe(2);
    expect(component.messagesFormArray.at(1).get('role')?.value).toBe('system');

    component.removeMessage(0);
    fixture.detectChanges();
    expect(component.messagesFormArray.length).toBe(1);
    expect(component.messagesFormArray.at(0).get('role')?.value).toBe('system');
  }));

  it('should add and remove tags from FormArray', fakeAsync(() => {
     mockActivatedRoute.data = of({ prompt: null });
     fixture.detectChanges(); tick(); fixture.detectChanges();

     const chipInputEl = document.createElement('input'); // Mock chip input element
     const chipInputEvent = { value: '  newTag  ', chipInput: { clear: jasmine.createSpy(), inputElement: chipInputEl } } as unknown as MatChipInputEvent;
     component.addTagFromInput(chipInputEvent);
     fixture.detectChanges();
     expect(component.tagsFormArray.length).toBe(1);
     expect(component.tagsFormArray.at(0).value).toBe('newTag');
     expect(chipInputEvent.chipInput!.clear).toHaveBeenCalled();

     component.removeTagAtIndex(0);
     fixture.detectChanges();
     expect(component.tagsFormArray.length).toBe(0);
  }));


  it('should not submit if form is invalid', fakeAsync(() => {
    mockActivatedRoute.data = of({ prompt: null });
    fixture.detectChanges(); tick(); fixture.detectChanges();
    component.promptForm.get('name')?.setValue(''); // Make form invalid
    fixture.detectChanges();
    component.onSubmit();
    tick();
    expect(mockPromptsService.createPrompt).not.toHaveBeenCalled();
    expect(mockPromptsService.updatePrompt).not.toHaveBeenCalled();
  }));

  it('goBack should call location.back', () => {
    component.goBack();
    expect(mockLocation.back).toHaveBeenCalled();
  });

  it('ngOnDestroy should complete destroy$ subject', () => {
     spyOn(component['destroy$'], 'next');
     spyOn(component['destroy$'], 'complete');
     component.ngOnDestroy();
     expect(component['destroy$'].next).toHaveBeenCalled();
     expect(component['destroy$'].complete).toHaveBeenCalled();
  });
});
