import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormBuilder, ReactiveFormsModule, FormArray, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { By } from '@angular/platform-browser';
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
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSliderModule } from '@angular/material/slider';


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
        MatChipsModule, MatProgressSpinnerModule, MatCardModule, MatSelectModule, MatTooltipModule,
        MatToolbarModule, MatSelectModule, MatSliderModule
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

  describe('Toolbar UI and Basic Functionality', () => {
    beforeEach(fakeAsync(() => {
      mockActivatedRoute.data = of({ prompt: null });
      fixture.detectChanges(); // ngOnInit
      tick();
      fixture.detectChanges();
    }));

    it('should display the "Prompt Studio" title', () => {
      const toolbarElement = fixture.nativeElement.querySelector('mat-toolbar');
      expect(toolbarElement).toBeTruthy();
      // Assuming the title is directly in the toolbar or a prominent span
      const titleElement = fixture.nativeElement.querySelector('mat-toolbar span[title="Prompt Studio"]');
      if (titleElement) {
        expect(titleElement.textContent).toContain('Prompt Studio');
      } else {
        // Fallback if not found via title attribute, check general text content
        expect(toolbarElement.textContent).toContain('Prompt Studio');
      }
    });

    it('should display the model mat-select', () => {
      const selectElement = fixture.nativeElement.querySelector('mat-toolbar mat-select[name="selectedModelCtrl"]');
      expect(selectElement).toBeTruthy();
    });

    it('should display the "Copy model name" button', () => {
      const copyButton = fixture.nativeElement.querySelector('mat-toolbar button[aria-label="Copy model name"]');
      expect(copyButton).toBeTruthy();
    });

    it('should display the "View code" button', () => {
      const allToolbarButtons = fixture.nativeElement.querySelectorAll('mat-toolbar button');
      const viewCodeButton = Array.from(allToolbarButtons).find((btn: Element) =>
        btn.textContent?.trim().includes('View code') || (btn as HTMLButtonElement).getAttribute('aria-label')?.includes('View code')
      );
      expect(viewCodeButton).toBeTruthy('Expected "View code" button to be present');
    });

    it('should have selectedModel initialized correctly', () => {
      // Assuming selectedModel is a public property as per prompt. If it's a signal, this would be component.selectedModel()
      expect(component.selectedModel).toBe('placeholder-model/name-here');
    });

    it('copyModelName() should execute without error and log to console', () => {
      spyOn(console, 'log');
      component.copyModelName();
      // Assuming selectedModel is a property. If signal, use component.selectedModel()
      expect(console.log).toHaveBeenCalledWith('Copying model name:', component.selectedModel);
    });

    it('viewCode() should execute without error and log to console', () => {
      spyOn(console, 'log');
      component.viewCode();
      // Assuming selectedModel is a property. If signal, use component.selectedModel()
      expect(console.log).toHaveBeenCalledWith('Viewing code for model:', component.selectedModel);
    });
  });

  describe('LLM Options Validation', () => {
    beforeEach(fakeAsync(() => {
      mockActivatedRoute.data = of({ prompt: null });
      fixture.detectChanges(); // ngOnInit
      tick();
      fixture.detectChanges();
    }));

    describe('temperature control', () => {
      let tempControl: any;
      beforeEach(() => {
        tempControl = component.promptForm.get('options.temperature');
      });

      it('should be invalid for value < 0', () => {
        tempControl?.setValue(-0.1);
        expect(tempControl?.hasError('min')).toBeTrue();
      });

      it('should be invalid for value > 2', () => {
        tempControl?.setValue(2.1);
        expect(tempControl?.hasError('max')).toBeTrue();
      });

      it('should be invalid for non-numeric pattern', () => {
        tempControl?.setValue('abc');
        expect(tempControl?.hasError('pattern')).toBeTrue();
      });

      it('should be valid for a correct value like 1.0', () => {
        tempControl?.setValue(1.0);
        expect(tempControl?.valid).toBeTrue();
      });
    });

    describe('maxTokens control', () => {
      let maxTokensControl: any;
      beforeEach(() => {
        maxTokensControl = component.promptForm.get('options.maxTokens');
      });

      it('should be invalid for value < 1', () => {
        maxTokensControl?.setValue(0);
        expect(maxTokensControl?.hasError('min')).toBeTrue();
      });

      it('should be invalid for non-integer pattern (text)', () => {
        maxTokensControl?.setValue('abc');
        expect(maxTokensControl?.hasError('pattern')).toBeTrue();
      });
      
      it('should be invalid for non-integer pattern (float)', () => {
        maxTokensControl?.setValue(10.5);
        expect(maxTokensControl?.hasError('pattern')).toBeTrue();
      });

      it('should be valid for a correct integer value like 2048', () => {
        maxTokensControl?.setValue(2048);
        expect(maxTokensControl?.valid).toBeTrue();
      });
    });
  });

  describe('Submit Button UI', () => {
    beforeEach(fakeAsync(() => {
      mockActivatedRoute.data = of({ prompt: null });
      fixture.detectChanges(); // ngOnInit
      tick();
      fixture.detectChanges();
    }));

    it('should display the shortcut chip when not saving', () => {
      component.isSaving.set(false);
      fixture.detectChanges();
      const chipListbox = fixture.nativeElement.querySelector('button[type="submit"] mat-chip-listbox');
      expect(chipListbox).toBeTruthy();
    });

    it('should not display the shortcut chip when saving', fakeAsync(() => {
      component.isSaving.set(true);
      fixture.detectChanges();
      tick(); 
      fixture.detectChanges();
      const chipListbox = fixture.nativeElement.querySelector('button[type="submit"] mat-chip-listbox');
      expect(chipListbox).toBeFalsy();
    }));
  });

  it('ngOnDestroy should complete destroy$ subject', () => {
     spyOn(component['destroy$'], 'next');
     spyOn(component['destroy$'], 'complete');
     component.ngOnDestroy();
     expect(component['destroy$'].next).toHaveBeenCalled();
     expect(component['destroy$'].complete).toHaveBeenCalled();
  });

  describe('Toolbar', () => {
    it('should render the toolbar', () => {
      const toolbarEl = fixture.debugElement.query(By.css('mat-toolbar.app-toolbar'));
      expect(toolbarEl).toBeTruthy();
    });

    it('should display the title "Prompt Studio" in the toolbar', () => {
      const titleEl = fixture.debugElement.query(By.css('mat-toolbar.app-toolbar .playground-title'));
      expect(titleEl.nativeElement.textContent.trim()).toBe('Prompt Studio');
    });

    it('should render the model selector dropdown', () => {
      const selectEl = fixture.debugElement.query(By.css('mat-toolbar.app-toolbar mat-select[name="toolbarSelectedModel"]'));
      expect(selectEl).toBeTruthy();
    });

    it('should render the copy model name button', () => {
      const copyButtonEl = fixture.debugElement.query(By.css('mat-toolbar.app-toolbar button[aria-label="Copy model name"]'));
      expect(copyButtonEl).toBeTruthy();
      const iconEl = copyButtonEl.query(By.css('mat-icon'));
      expect(iconEl.nativeElement.textContent.trim()).toBe('content_copy');
    });

    it('should render the "View code" button', () => {
      const viewCodeButtonEl = fixture.debugElement.query(By.css('mat-toolbar.app-toolbar button.view-code-button'));
      expect(viewCodeButtonEl).toBeTruthy();
      expect(viewCodeButtonEl.nativeElement.textContent).toContain('View code');
      const iconEl = viewCodeButtonEl.query(By.css('mat-icon'));
      expect(iconEl.nativeElement.textContent.trim()).toBe('code');
    });
  });

  describe('LLM Options Parameters', () => {
    let optionsGroup: FormGroup;

    beforeEach(() => {
      fixture.detectChanges(); // Ensure view is stable if ngOnInit was called by TestBed
      optionsGroup = component.promptForm.get('options') as FormGroup;
    });

    it('should render temperature slider and input', () => {
      expect(optionsGroup).toBeTruthy('Options form group should exist');
      const tempSlider = fixture.debugElement.query(By.css('mat-slider[formControlName="temperature"]'));
      expect(tempSlider).toBeTruthy();
      const tempInput = fixture.debugElement.query(By.css('div.parameter-item input[formControlName="temperature"][type="number"]'));
      expect(tempInput).toBeTruthy();
    });

    it('should render maxTokens slider and input', () => {
      expect(optionsGroup).toBeTruthy('Options form group should exist');
      const tokensSlider = fixture.debugElement.query(By.css('mat-slider[formControlName="maxTokens"]'));
      expect(tokensSlider).toBeTruthy();
      const tokensInput = fixture.debugElement.query(By.css('div.parameter-item input[formControlName="maxTokens"][type="number"]'));
      expect(tokensInput).toBeTruthy();
    });

    it('temperature slider and input should be bound to the same form control', () => {
      expect(optionsGroup).toBeTruthy('Options form group should exist');
      const tempControl = optionsGroup.get('temperature');
      expect(tempControl).toBeTruthy('Temperature form control should exist');
      const tempInputDebugEl = fixture.debugElement.query(By.css('div.parameter-item input[formControlName="temperature"][type="number"]'));

      tempControl.setValue(0.5);
      fixture.detectChanges();
      expect(tempInputDebugEl.nativeElement.value).toBe('0.5');

      tempInputDebugEl.nativeElement.value = '0.8';
      tempInputDebugEl.nativeElement.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(tempControl.value).toBe(0.8);
    });

    it('maxTokens slider and input should be bound to the same form control', () => {
      expect(optionsGroup).toBeTruthy('Options form group should exist');
      const maxTokensControl = optionsGroup.get('maxTokens');
      expect(maxTokensControl).toBeTruthy('MaxTokens form control should exist');
      const maxTokensInputDebugEl = fixture.debugElement.query(By.css('div.parameter-item input[formControlName="maxTokens"][type="number"]'));

      maxTokensControl.setValue(1024);
      fixture.detectChanges();
      expect(maxTokensInputDebugEl.nativeElement.value).toBe('1024');

      maxTokensInputDebugEl.nativeElement.value = '512';
      maxTokensInputDebugEl.nativeElement.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(maxTokensControl.value).toBe(512);
    });
  });
});
