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
import { LlmService, LLM as AppLLM } from '../../agents/services/llm.service';
import type { Prompt } from '#shared/model/prompts.model';
import type { LlmMessage, UserContentExt, TextPart, ImagePartExt, FilePartExt } from '#shared/model/llm.model';
import type { PromptSchemaModel } from '#shared/schemas/prompts.schema';

const mockLlms: AppLLM[] = [
  { id: 'llm-1', name: 'LLM One', isConfigured: true },
  { id: 'llm-2', name: 'LLM Two', isConfigured: true },
  { id: 'llm-3', name: 'LLM Three (Not Configured)', isConfigured: false },
];

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
  settings: { temperature: 0.7, maxOutputTokens: 100, llmId: 'llm-1' }, // Changed selectedModel to llmId
  // Assuming updatedAt is not strictly required by the form population logic,
  // but keeping it if it was part of a broader mock structure.
  // If Prompt type requires it, it should be present. Let's assume it's optional or handled.
  // For the purpose of these tests, it's not directly used by _convertLlmContentToString.
};
const mockPromptSchema = mockPrompt as PromptSchemaModel; // This cast might need adjustment if PromptSchemaModel is stricter


describe('PromptFormComponent', () => {
  let component: PromptFormComponent;
  let fixture: ComponentFixture<PromptFormComponent>;
  let mockPromptsService: jasmine.SpyObj<PromptsService>;
  let mockLlmService: jasmine.SpyObj<LlmService>;
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

    mockLlmService = jasmine.createSpyObj('LlmService', ['getLlms', 'clearCache']);
    mockLlmService.getLlms.and.returnValue(of(mockLlms));


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
        { provide: LlmService, useValue: mockLlmService },
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
    beforeEach(fakeAsync(() => { // Make beforeEach fakeAsync
      mockActivatedRoute.data = of({ prompt: null });
      mockActivatedRoute.snapshot.paramMap = convertToParamMap({});
      fixture.detectChanges(); // ngOnInit -> triggers getLlms
      tick(); // Complete getLlms
      fixture.detectChanges(); // Apply LLMs and processRouteData
    }));

    it('should initialize form for new prompt with default LLM selected', () => {
      expect(component.isEditMode()).toBeFalse();
      expect(component.promptForm).toBeDefined();
      expect(component.promptForm.get('name')?.value).toBe('');
      expect(component.messagesFormArray.length).toBe(1);
      expect(component.messagesFormArray.at(0).get('role')?.value).toBe('user');
      expect(component.promptForm.get('options.llmId')?.value).toBe(mockLlms.find(l => l.isConfigured)?.id); // First configured LLM
      expect(component.isLoading()).toBeFalse();
    });

    it('should call promptsService.clearSelectedPrompt', () => {
      // This is called within processRouteData if not in edit mode
      expect(mockPromptsService.clearSelectedPrompt).toHaveBeenCalled();
    });

    it('onSubmit should call promptsService.createPrompt with correct payload including selectedModel', fakeAsync(() => {
      mockPromptsService.createPrompt.and.returnValue(of(mockPromptSchema));
      const llmId = mockLlms.find(l => l.isConfigured)!.id;
      component.promptForm.patchValue({
        name: 'New Prompt Name',
        options: { temperature: 0.5, maxOutputTokens: 500, llmId: llmId }
      });
      component.messagesFormArray.at(0).patchValue({ role: 'user', content: 'User message' });
      component.tagsFormArray.push(new FormBuilder().control('newTag'));
      fixture.detectChanges();

      component.onSubmit();
      tick();

      expect(mockPromptsService.createPrompt).toHaveBeenCalledWith(jasmine.objectContaining({
        name: 'New Prompt Name',
        messages: [{ role: 'user', content: 'User message' }],
        tags: ['newTag'],
        options: { temperature: 0.5, maxOutputTokens: 500, llmId: llmId }
      }));
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/prompts']);
    }));
  });

  describe('Edit Mode', () => {
     beforeEach(fakeAsync(() => { // Make beforeEach fakeAsync
         mockActivatedRoute.data = of({ prompt: mockPrompt }); // mockPrompt has options.selectedModel = 'llm-1'
         mockActivatedRoute.snapshot.paramMap = convertToParamMap({ promptId: mockPrompt.id });
         fixture.detectChanges(); // ngOnInit -> triggers getLlms
         tick(); // Complete getLlms
         fixture.detectChanges(); // Apply LLMs and processRouteData
     }));

     it('should initialize form for edit prompt and call populateForm', () => {
         expect(component.isEditMode()).toBeTrue();
         expect(component.promptIdSignal()).toBe(mockPrompt.id);
         expect(component.promptForm.get('name')?.value).toBe(mockPrompt.name);
         expect(component.promptForm.get('options.llmId')?.value).toBe(mockPrompt.settings.llmId);
         expect(component.messagesFormArray.length).toBe(mockPrompt.messages.length);
         expect(component.tagsFormArray.length).toBe(mockPrompt.tags.length);
         expect(component.isLoading()).toBeFalse();
     });

     it('onSubmit should call promptsService.updatePrompt with correct payload', fakeAsync(() => {
         mockPromptsService.updatePrompt.and.returnValue(of(mockPromptSchema));
         const updatedName = 'Updated Prompt Name';
         component.promptForm.get('name')?.setValue(updatedName);
         // llmId should already be set from mockPrompt
         fixture.detectChanges();

         component.onSubmit();
         tick();

         expect(mockPromptsService.updatePrompt).toHaveBeenCalledWith(mockPrompt.id, jasmine.objectContaining({
             name: updatedName,
             options: jasmine.objectContaining({ llmId: mockPrompt.settings.llmId })
         }));
         expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/prompts']);
     }));

     it('should navigate if promptId in params but resolver returns null', fakeAsync(() => {
         mockActivatedRoute.data = of({ prompt: null }); // Resolver returns null
         mockActivatedRoute.snapshot.paramMap = convertToParamMap({ promptId: 'some-id-that-failed' });
         spyOn(console, 'error');
         fixture.detectChanges(); // ngOnInit -> getLlms
         tick(); // Complete getLlms
         fixture.detectChanges(); // processRouteData

         expect(console.error).toHaveBeenCalledWith('Prompt not found for editing, navigating back.');
         expect(mockRouter.navigate).toHaveBeenCalledWith(['/ui/prompts']);
     }));
  });


  it('should add and remove messages from FormArray', fakeAsync(() => {
    mockActivatedRoute.data = of({ prompt: null });
    fixture.detectChanges(); tick(); fixture.detectChanges(); // For ngOnInit, getLlms, processRouteData

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
     fixture.detectChanges(); tick(); fixture.detectChanges(); // For ngOnInit, getLlms, processRouteData

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
    fixture.detectChanges(); tick(); fixture.detectChanges(); // For ngOnInit, getLlms, processRouteData
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
      fixture.detectChanges(); // ngOnInit -> getLlms
      tick(); // Complete getLlms
      fixture.detectChanges(); // processRouteData
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
      fixture.detectChanges(); // ngOnInit -> getLlms
      tick(); // Complete getLlms
      fixture.detectChanges(); // processRouteData
    }));

    it('llmId control should be required', () => {
      const modelControl = component.promptForm.get('options.llmId');
      modelControl?.setValue(null);
      expect(modelControl?.hasError('required')).toBeTrue();
      modelControl?.setValue(mockLlms.find(l => l.isConfigured)!.id);
      expect(modelControl?.valid).toBeTrue();
    });

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

    describe('maxOutputTokens control', () => {
      let maxOutputTokensControl: any;
      beforeEach(() => {
        maxOutputTokensControl = component.promptForm.get('options.maxOutputTokens');
      });

      it('should be invalid for value < 1', () => {
        maxOutputTokensControl?.setValue(0);
        expect(maxOutputTokensControl?.hasError('min')).toBeTrue();
      });

      it('should be invalid for non-integer pattern (text)', () => {
        maxOutputTokensControl?.setValue('abc');
        expect(maxOutputTokensControl?.hasError('pattern')).toBeTrue();
      });

      it('should be invalid for non-integer pattern (float)', () => {
        maxOutputTokensControl?.setValue(10.5);
        expect(maxOutputTokensControl?.hasError('pattern')).toBeTrue();
      });

      it('should be valid for a correct integer value like 2048', () => {
        maxOutputTokensControl?.setValue(2048);
        expect(maxOutputTokensControl?.valid).toBeTrue();
      });
    });
  });

  describe('Submit Button UI', () => {
    beforeEach(fakeAsync(() => {
      mockActivatedRoute.data = of({ prompt: null });
      fixture.detectChanges(); // ngOnInit -> getLlms
      tick(); // Complete getLlms
      fixture.detectChanges(); // processRouteData
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

    beforeEach(fakeAsync(() => { // Make beforeEach fakeAsync
      mockActivatedRoute.data = of({ prompt: null });
      fixture.detectChanges(); // ngOnInit -> getLlms
      tick(); // Complete getLlms
      fixture.detectChanges(); // processRouteData
      optionsGroup = component.promptForm.get('options') as FormGroup;
    }));

    it('should render model selector dropdown', () => {
        expect(optionsGroup).toBeTruthy('Options form group should exist');
        const modelSelect = fixture.debugElement.query(By.css('mat-select[formControlName="llmId"]'));
        expect(modelSelect).toBeTruthy();
        // Check if options are populated (assuming at least one configured LLM)
        // This requires opening the select, which can be complex in tests.
        // For now, just check if the component's availableModels has items.
        expect(component.availableModels.filter(m => m.isConfigured).length).toBeGreaterThan(0);
    });

    it('should render temperature slider and input', () => {
      expect(optionsGroup).toBeTruthy('Options form group should exist');
      const tempSlider = fixture.debugElement.query(By.css('mat-slider[aria-labelledby="temperature-label"]'));
      expect(tempSlider).toBeTruthy('Temperature slider should exist');
      const tempInput = fixture.debugElement.query(By.css('div.parameter-item input[formControlName="temperature"][type="number"]'));
      expect(tempInput).toBeTruthy('Temperature input should exist');
    });

    it('should render maxOutputTokens slider and input', () => {
      expect(optionsGroup).toBeTruthy('Options form group should exist');
      const tokensSlider = fixture.debugElement.query(By.css('mat-slider[aria-labelledby="maxOutputTokens-label"]'));
      expect(tokensSlider).toBeTruthy('Max tokens slider should exist');
      const tokensInput = fixture.debugElement.query(By.css('div.parameter-item input[formControlName="maxOutputTokens"][type="number"]'));
      expect(tokensInput).toBeTruthy('Max tokens input should exist');
    });

    it('temperature slider and input should be bound to the same form control', () => {
      expect(optionsGroup).toBeTruthy('Options form group should exist');
      const tempControl = optionsGroup.get('temperature');
      expect(tempControl).toBeTruthy('Temperature form control should exist');
      const tempInputDebugEl = fixture.debugElement.query(By.css('div.parameter-item input[formControlName="temperature"][type="number"]'));

      tempControl?.setValue(0.5);
      fixture.detectChanges();
      expect(tempInputDebugEl.nativeElement.value).toBe('0.5');

      tempInputDebugEl.nativeElement.value = '0.8';
      tempInputDebugEl.nativeElement.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(tempControl?.value).toBe(0.8); // Form control stores number
    });

    it('maxOutputTokens slider and input should be bound to the same form control', () => {
      expect(optionsGroup).toBeTruthy('Options form group should exist');
      const maxOutputTokensControl = optionsGroup.get('maxOutputTokens');
      expect(maxOutputTokensControl).toBeTruthy('MaxTokens form control should exist');
      const maxOutputTokensInputDebugEl = fixture.debugElement.query(By.css('div.parameter-item input[formControlName="maxOutputTokens"][type="number"]'));

      maxOutputTokensControl?.setValue(1024);
      fixture.detectChanges();
      expect(maxOutputTokensInputDebugEl.nativeElement.value).toBe('1024');

      maxOutputTokensInputDebugEl.nativeElement.value = '512';
      maxOutputTokensInputDebugEl.nativeElement.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(maxOutputTokensControl?.value).toBe(512); // Form control stores number
    });
  });

  describe('populateForm message content handling', () => {
    const baseTestPromptSettings = {
      llmId: mockLlms.find(l => l.isConfigured && l.id === 'llm-1')!.id || mockLlms.find(l => l.isConfigured)!.id, // Prefer llm-1 if available
      temperature: 1.0,
      maxOutputTokens: 2048
    };

    const createBasePrompt = (name: string, messages: LlmMessage[]): Prompt => ({
      id: `test-${name.toLowerCase().replace(/\s+/g, '-')}`,
      userId: 'test-user',
      revisionId: 1,
      name,
      tags: [],
      messages,
      settings: baseTestPromptSettings,
    });

    beforeEach(fakeAsync(() => {
      // Ensure LLMs are loaded and form is initialized before each test in this suite
      mockActivatedRoute.data = of({ prompt: null }); // Start with a base state for new prompt
      fixture.detectChanges(); // ngOnInit -> triggers getLlms
      tick(); // Complete getLlms
      fixture.detectChanges(); // Apply LLMs and processRouteData (initializes form)
    }));

    it('should correctly populate message content when LlmMessage.content is a simple string', fakeAsync(() => {
      const testPrompt = createBasePrompt('Simple String Test', [{ role: 'user', content: 'Hello world' }]);
      component.populateForm(testPrompt);
      fixture.detectChanges();
      tick();
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('Hello world');
    }));

    it('should correctly populate message content when LlmMessage.content is an array with only TextPart', fakeAsync(() => {
      const contentArray: TextPart[] = [{ type: 'text', text: 'First line.' }, { type: 'text', text: 'Second line.' }];
      const testPrompt = createBasePrompt('TextPart Array Test', [{ role: 'user', content: contentArray as UserContentExt }]);
      component.populateForm(testPrompt);
      fixture.detectChanges();
      tick();
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('First line.\n\nSecond line.');
    }));

    it('should correctly populate message content with placeholder for ImagePartExt', fakeAsync(() => {
      const contentArray1: ImagePartExt[] = [{ type: 'image', image: 'base64data', mimeType: 'image/png', filename: 'test.png' }];
      let testPrompt1 = createBasePrompt('ImagePart Filename Test', [{ role: 'user', content: contentArray1 as UserContentExt }]);
      component.populateForm(testPrompt1);
      fixture.detectChanges();
      tick();
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('[Image: test.png]');

      const contentArray2: ImagePartExt[] = [{ type: 'image', image: 'base64data', mimeType: 'image/jpeg' }];
      let testPrompt2 = createBasePrompt('ImagePart MimeType Test', [{ role: 'user', content: contentArray2 as UserContentExt }]);
      component.populateForm(testPrompt2);
      fixture.detectChanges();
      tick();
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('[Image: image/jpeg]');
    }));

    it('should correctly populate message content with placeholder for FilePartExt', fakeAsync(() => {
      const contentArray1: FilePartExt[] = [{ type: 'file', data: 'base64data', mimeType: 'application/pdf', filename: 'document.pdf' }];
      let testPrompt1 = createBasePrompt('FilePart Filename Test', [{ role: 'user', content: contentArray1 as UserContentExt }]);
      component.populateForm(testPrompt1);
      fixture.detectChanges();
      tick();
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('[File: document.pdf]');

      const contentArray2: FilePartExt[] = [{ type: 'file', data: 'base64data', mimeType: 'text/plain' }];
      let testPrompt2 = createBasePrompt('FilePart MimeType Test', [{ role: 'user', content: contentArray2 as UserContentExt }]);
      component.populateForm(testPrompt2);
      fixture.detectChanges();
      tick();
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('[File: text/plain]');
    }));

    it('should correctly populate message content with mixed parts (text, image, file)', fakeAsync(() => {
      const mixedContent: UserContentExt = [
        { type: 'text', text: 'Here is an image:' },
        { type: 'image', image: 'img_data', mimeType: 'image/gif', filename: 'anim.gif' },
        { type: 'text', text: 'And a file:' },
        { type: 'file', data: 'file_data', mimeType: 'application/zip', filename: 'archive.zip' }
      ];
      const testPrompt = createBasePrompt('Mixed Parts Test', [{ role: 'user', content: mixedContent }]);
      component.populateForm(testPrompt);
      fixture.detectChanges();
      tick();
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('Here is an image:\n\n[Image: anim.gif]\n\nAnd a file:\n\n[File: archive.zip]');
    }));

    it('should handle LlmMessage.content as an empty array', fakeAsync(() => {
      const testPrompt = createBasePrompt('Empty Array Content Test', [{ role: 'user', content: [] as UserContentExt }]);
      component.populateForm(testPrompt);
      fixture.detectChanges();
      tick();
      // populateForm adds a default user message if messages array is empty after processing
      // and includeSystemMessage is false.
      // If the prompt's message content is an empty array, _convertLlmContentToString returns '',
      // so the message content in the form will be ''.
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('');
    }));

    it('should handle LlmMessage.content as undefined', fakeAsync(() => {
      const testPrompt = createBasePrompt('Undefined Content Test', [{ role: 'user', content: undefined as unknown as UserContentExt }]);
      component.populateForm(testPrompt);
      fixture.detectChanges();
      tick();
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('');
    }));

    it('should handle LlmMessage.content with unknown part types gracefully', fakeAsync(() => {
      const unknownContent: UserContentExt = [
        { type: 'text', text: 'Known' },
        { type: 'exotic_part_type', someData: 'foo' } as any // Cast to any to simulate unknown part
      ];
      const testPrompt = createBasePrompt('Unknown Part Test', [{ role: 'user', content: unknownContent }]);
      component.populateForm(testPrompt);
      fixture.detectChanges();
      tick();
      expect(component.messagesFormArray.at(0).get('content')?.value).toBe('Known\n\n[Unknown part type: exotic_part_type]');
    }));
  });
});
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { PromptsService } from '../prompts.service';
import { LlmService } from '../../agents/services/llm.service';
import { PromptFormComponent } from './prompt-form.component';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { of } from 'rxjs';
import { signal } from '@angular/core'; // Import signal

describe('PromptFormComponent', () => {
  let component: PromptFormComponent;
  let fixture: ComponentFixture<PromptFormComponent>;
  let mockPromptsService: any;
  let mockLlmService: any;

  beforeEach(waitForAsync(() => {
    mockPromptsService = {
      createPrompt: jasmine.createSpy('createPrompt').and.returnValue(of({})),
      updatePrompt: jasmine.createSpy('updatePrompt').and.returnValue(of({})),
      clearSelectedPrompt: jasmine.createSpy('clearSelectedPrompt'),
      getPromptById: jasmine.createSpy('getPromptById').and.returnValue(of(null)),
      selectedPrompt: signal(null), // Use signal for selectedPrompt
    };

    mockLlmService = {
      getLlms: jasmine.createSpy('getLlms').and.returnValue(of([{ id: 'test-llm', name: 'Test LLM', isConfigured: true }])),
    };

    TestBed.configureTestingModule({
      imports: [
        PromptFormComponent, // Standalone component
        ReactiveFormsModule,
        NoopAnimationsModule,
        RouterTestingModule,
        MatSnackBarModule,
        MatExpansionModule,
        MatFormFieldModule,
        MatInputModule,
        MatChipsModule,
        MatSelectModule,
        MatIconModule,
        MatButtonModule,
        MatSlideToggleModule,
      ],
      providers: [
        { provide: PromptsService, useValue: mockPromptsService },
        { provide: LlmService, useValue: mockLlmService },
      ],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(PromptFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe.skip('Attachment Functionality', () => {
    it('should allow adding an attachment via file input', () => {
      // Test onFileSelected
    });

    it('should allow adding an attachment via drag and drop', () => {
      // Test onDrop
    });

    it('should display previews for image attachments', () => {
      // Check DOM for img tag with src
    });

    it('should display generic icon and info for file attachments', () => {
      // Check DOM for file icon and details
    });

    it('should allow removing an attachment', () => {
      // Test removeAttachment and check FormArray
    });

    it('should include attachment data in the form submission payload', () => {
      // Mock attachments, submit form, and check payload
    });

    it('should correctly populate attachments when editing a prompt with existing attachments', () => {
      // Mock a prompt with UserContentExt, call populateForm, check attachments FormArray
    });
  });
});
