import { Component, OnInit, inject, signal, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location, TitleCasePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { trigger, state, style, transition, animate } from '@angular/animations';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule, FormControl } from '@angular/forms'; // Add FormsModule
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
// MatSliderModule is already imported, ensure it's here. If not, it would be added.
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkTextareaAutosize } from '@angular/cdk/text-field'; // Import CdkTextareaAutosize

import { PromptsService } from '../prompts.service';
import { LlmService, LLM as AppLLM } from '../../agents/services/llm.service'; // Renamed LLM to AppLLM to avoid conflict
import type { Prompt } from '#shared/model/prompts.model'; // Ensure Prompt is imported directly
import type { LlmMessage, GenerateOptions } from '#shared/model/llm.model';
import type { PromptCreatePayload, PromptUpdatePayload, PromptSchemaModel } from '#shared/schemas/prompts.schema';

import { Subject, Observable, forkJoin } from 'rxjs';
import { takeUntil, finalize, tap, filter } from 'rxjs/operators';

@Component({
  selector: 'app-prompt-form',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    // FormsModule, // Add FormsModule here
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSliderModule,
    MatSlideToggleModule,
    MatToolbarModule,
    MatTooltipModule,
    TitleCasePipe,
    CdkTextareaAutosize // Add CdkTextareaAutosize here
  ],
  templateUrl: './prompt-form.component.html',
  styleUrls: ['./prompt-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('summaryFade', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('250ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ opacity: 1 })),
      ]),
      transition(':leave', [
        animate('250ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ opacity: 0 })),
      ]),
    ]),
  ],
})
export class PromptFormComponent implements OnInit, OnDestroy {
  private promptsService = inject(PromptsService);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private cdr = inject(ChangeDetectorRef);
  private llmService = inject(LlmService);

  promptForm!: FormGroup;
  isEditMode = signal(false);
  promptIdSignal = signal<string | null>(null); // Renamed to avoid conflict with component property
  isLoading = signal(true);
  isSaving = signal(false);
  private destroy$ = new Subject<void>();

  tagCtrl = new FormControl('');
  readonly separatorKeysCodes: number[] = [13, 188];

  readonly llmMessageRoles: Array<{value: LlmMessage['role'], viewValue: string}> = [
    {value: 'user', viewValue: 'User'}, // Only user/assistant for the array
    {value: 'assistant', viewValue: 'Assistant'}
  ];

  public selectedModel: string = 'claude-3-opus'; // Placeholder, a common modern model for the toolbar
  public availableModels: AppLLM[] = []; // Will be populated by LlmService

  // Signals for card collapsibility (matching HTML usage)
  // detailsCollapsed = signal(false); // REMOVED: Using mat-expansion-panel's internal state
  // messagesCollapsed = signal(false); // For the entire "Messages" card - REMOVED
  optionsCollapsed = signal(false);

  // Signal for individual message item collapsibility - REMOVED
  // messageItemCollapsedStates = signal<boolean[]>([]);


  ngOnInit(): void {
    this.promptForm = this.fb.group({
      name: ['', Validators.required],
      tags: this.fb.array([]),
      includeSystemMessage: [false], // Toggle for system message
      systemMessageContent: [''], // Content for the system message
      messages: this.fb.array([], Validators.minLength(1)), // This array now only holds user/assistant messages
      options: this.fb.group({
        llmId: [null, Validators.required], // Changed from selectedModel to llmId
        temperature: [1.0, [Validators.required, Validators.min(0), Validators.max(2), Validators.pattern(/^\d*(\.\d+)?$/)]],
        maxOutputTokens: [2048, [Validators.required, Validators.min(1), Validators.max(8192), Validators.pattern(/^[0-9]*$/)]],
      }),
    });

    // Subscribe to includeSystemMessage changes to trigger validation/updates
    this.promptForm.get('includeSystemMessage')?.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      // We need to re-evaluate validation on the messages array
      // if the system message is toggled, as minLength(1) applies
      // to the *combined* list in the payload, but the validator
      // is on the user/assistant array.
      // A simpler approach is to just ensure the user/assistant array
      // has at least one message if the system message is off.
      this.updateAndValidateMessages();
      this.cdr.detectChanges(); // Ensure UI updates if system message field appears/disappears
    });


    this.isLoading.set(true);
    // Fetch LLMs and then process route data
    this.llmService.getLlms().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (llms) => {
        this.availableModels = llms.filter(llm => llm.isConfigured);
        // Now that LLMs are loaded, process route data for prompt editing or creation
        this.processRouteData();
      },
      error: (err) => {
        console.error('Failed to load LLMs', err);
        this.availableModels = []; // Ensure it's an empty array on error
        this.processRouteData(); // Still process route data to show form, though model selection might be empty
      }
    });
  }

  private processRouteData(): void {
    this.route.data.pipe(
      takeUntil(this.destroy$)
    ).subscribe(data => {
      const resolvedPrompt = data['prompt'] as Prompt | null;
      if (resolvedPrompt && resolvedPrompt.id) {
        this.promptIdSignal.set(resolvedPrompt.id);
        this.isEditMode.set(true);
        this.populateForm(resolvedPrompt);
      } else {
        if (this.route.snapshot.paramMap.get('promptId') && !resolvedPrompt) {
          console.error('Prompt not found for editing, navigating back.');
          this.router.navigate(['/ui/prompts']).catch(console.error);
          this.isLoading.set(false);
          this.cdr.detectChanges();
          return;
        }
        this.isEditMode.set(false);
        this.promptsService.clearSelectedPrompt();
        // Set default model if creating new and models are available
        if (this.availableModels.length > 0) {
          this.promptForm.get('options.llmId')?.setValue(this.availableModels[0].id); // Changed from selectedModel
        }
      }
      // Always ensure message array state is correct after processing route data
      this.updateAndValidateMessages();
      this.isLoading.set(false);
      this.cdr.detectChanges();
    });
  }

  get messagesFormArray(): FormArray {
    return this.promptForm.get('messages') as FormArray;
  }

  get tagsFormArray(): FormArray {
    return this.promptForm.get('tags') as FormArray;
  }

  createMessageGroup(role: LlmMessage['role'] = 'user', content: string = ''): FormGroup {
    // Note: Role here is just an initial value; updateMessageRoles will enforce alternation
    return this.fb.group({
      role: [role, Validators.required],
      content: [content, Validators.required],
    });
  }

  addMessage(): void {
    // Add a new message group to the user/assistant array
    this.messagesFormArray.push(this.createMessageGroup('user', '')); // Initial role is 'user'
    this.updateAndValidateMessages(); // Re-evaluate roles and validation
  }

  removeMessage(index: number): void {
    // Remove message from the user/assistant array
    this.messagesFormArray.removeAt(index);
    this.updateAndValidateMessages(); // Re-evaluate roles and validation
  }

  private updateMessageRoles(): void {
    const messages = this.messagesFormArray.controls as FormGroup[];
    let currentAlternatingRole: LlmMessage['role'] = 'user'; // Always start with 'user' for this array

    for (let i = 0; i < messages.length; i++) {
      const msgGroup = messages[i];
      // Only update if the role is incorrect for the position
      if (msgGroup.get('role')?.value !== currentAlternatingRole) {
        msgGroup.get('role')?.setValue(currentAlternatingRole, { emitEvent: false });
      }
      // Alternate the expected role for the next message
      currentAlternatingRole = currentAlternatingRole === 'user' ? 'assistant' : 'user';
    }
  }

  private updateAndValidateMessages(): void {
    this.updateMessageRoles(); // Ensure roles are alternating user/assistant

    // Ensure at least one user/assistant message if the array is empty
    // This is needed because the minLength(1) validator is on this array,
    // but the actual requirement is minLength(1) for the *combined* list
    // sent to the API (system + user/assistant). If system message is off,
    // we need at least one user/assistant message.
    const includeSystem = this.promptForm.get('includeSystemMessage')?.value;
    const systemContent = this.promptForm.get('systemMessageContent')?.value;
    const hasSystemMessage = includeSystem && systemContent && systemContent.trim() !== '';

    // If there's no system message AND the user/assistant array is empty, add one.
    if (!hasSystemMessage && this.messagesFormArray.length === 0) {
        this.messagesFormArray.push(this.createMessageGroup('user', ''));
        this.updateMessageRoles(); // Re-run to set the role of the newly added message
    }

    // Re-run validation on the messages array
    this.messagesFormArray.updateValueAndValidity({ emitEvent: false });
    // Also trigger validation on the main form group to reflect the messages array validity
    this.promptForm.updateValueAndValidity({ emitEvent: false });

    this.cdr.detectChanges();
  }


  populateForm(prompt: Prompt): void {
    const defaultOptions: GenerateOptions & { llmId?: string | null } = { // Changed from selectedModel
      llmId: this.availableModels.length > 0 ? this.availableModels[0].id : null, // Changed from selectedModel
      temperature: 1.0,
      maxOutputTokens: 2048,
    };

    this.promptForm.patchValue({
      name: prompt.name,
      // includeSystemMessage and systemMessageContent will be set below
    }, { emitEvent: false });

    // ... (options patching logic remains the same) ...
    const promptOptions = prompt.options || {};
    let llmIdToPatch = defaultOptions.llmId;
    if (promptOptions.llmId && this.availableModels.find(m => m.id === promptOptions.llmId)) {
      llmIdToPatch = promptOptions.llmId;
    } else if (promptOptions.llmId) {
      console.warn(`Prompt's saved LLM ID "${promptOptions.llmId}" is not available. Defaulting.`);
    }
    const optionsToPatch = { ...defaultOptions, ...promptOptions, llmId: llmIdToPatch };
    this.promptForm.get('options')?.patchValue(optionsToPatch, { emitEvent: false });


    this.tagsFormArray.clear();
    (prompt.tags || []).forEach(tag => this.tagsFormArray.push(this.fb.control(tag)));

    this.messagesFormArray.clear(); // Clear user/assistant messages

    const currentMessages = prompt.messages || [];
    let systemContent = '';
    let includeSystem = false;
    const userAssistantMessages: LlmMessage[] = [];

    // Check if the first message is a system message
    if (currentMessages.length > 0 && currentMessages[0].role === 'system') {
      includeSystem = true;
      systemContent = currentMessages[0].content as string;
      // The rest are user/assistant messages
      userAssistantMessages.push(...currentMessages.slice(1));
    } else {
      // No system message, all messages are user/assistant
      userAssistantMessages.push(...currentMessages);
    }

    // Populate the user/assistant messages form array
    userAssistantMessages.forEach(msg => {
      // We don't need to validate role here, updateMessageRoles will fix it later
      this.messagesFormArray.push(this.createMessageGroup(msg.role, msg.content as string));
    });


    // Set the system message fields
    this.promptForm.get('includeSystemMessage')?.setValue(includeSystem, { emitEvent: false });
    this.promptForm.get('systemMessageContent')?.setValue(systemContent, { emitEvent: false });

    // updateAndValidateMessages will be called by processRouteData after this
  }

  onSubmit(): void {
    // Manually trigger validation on all controls before checking validity
    this.promptForm.markAllAsTouched();
    this.messagesFormArray.markAllAsTouched(); // Ensure message controls are touched

    // Re-run validation logic one last time before checking form validity
    this.updateAndValidateMessages();

    if (this.promptForm.invalid) {
      console.warn('Form is invalid:', this.promptForm.errors, this.messagesFormArray.errors);
      // Optionally scroll to the first invalid field
      const firstInvalidControl: HTMLElement = document.querySelector(
        'form .mat-form-field.ng-invalid, form .ng-invalid textarea' // Broader selector for textareas
      )!;
      if (firstInvalidControl) {
        firstInvalidControl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    this.isSaving.set(true);
    const formValue = this.promptForm.value;

    const finalMessages: LlmMessage[] = [];

    // Add system message if included and has content
    if (formValue.includeSystemMessage && formValue.systemMessageContent && formValue.systemMessageContent.trim() !== '') {
      finalMessages.push({ role: 'system', content: formValue.systemMessageContent.trim() });
    }

    // Add user/assistant messages from the form array
    // The roles in the form array should already be correct ('user'/'assistant') due to updateMessageRoles
    const userAssistantMessages = formValue.messages.map((msg: {role: LlmMessage['role'], content: string}) => ({
        role: msg.role,
        content: msg.content
    }));
    finalMessages.push(...userAssistantMessages);

    // Check if the final message list is empty (shouldn't happen if validation works, but as a safeguard)
    if (finalMessages.length === 0) {
        console.error('Attempted to submit with no messages.');
        this.isSaving.set(false);
        this.cdr.detectChanges();
        return;
    }


    const payload: PromptCreatePayload | PromptUpdatePayload = {
      name: formValue.name,
      tags: formValue.tags,
      messages: finalMessages, // Use the combined messages
      options: formValue.options,
    };

    let operation$: Observable<PromptSchemaModel>;

    if (this.isEditMode() && this.promptIdSignal()) {
      operation$ = this.promptsService.updatePrompt(this.promptIdSignal()!, payload as PromptUpdatePayload);
    } else {
      operation$ = this.promptsService.createPrompt(payload as PromptCreatePayload);
    }

    operation$.pipe(
      takeUntil(this.destroy$),
      finalize(() => {
        this.isSaving.set(false);
        this.cdr.detectChanges();
    })
    ).subscribe({
      next: (savedPrompt) => {
        this.router.navigate(['/ui/prompts']).catch(console.error);
      },
      error: (err) => {
        console.error('Failed to save prompt', err);
      }
    });
  }

  goBack(): void {
    this.location.back();
  }

  public copyModelName(): void {
    console.log('Copy model name clicked for:', this.selectedModel);
    // Placeholder action
  }

  // Toggle methods for card collapsibility (matching HTML usage)
  // toggleDetails(): void { // REMOVED: Using mat-expansion-panel's internal state
  //   this.detailsCollapsed.update(v => !v);
  // }

  // toggleMessages(): void { // This is for the entire Messages card - REMOVED
  //   this.messagesCollapsed.update(v => !v);
  // }

  toggleOptions(): void {
    this.optionsCollapsed.update(v => !v);
  }

  // Toggle method for individual message items - REMOVED
  // toggleMessageItemCollapse(index: number): void {
  //   this.messageItemCollapsedStates.update(states => {
  //     const newStates = [...states];
  //     // Ensure the index exists before toggling
  //     if (index >= 0 && index < newStates.length) {
  //       newStates[index] = !newStates[index];
  //     }
  //     return newStates;
  //   });
  // }

  /**
   * Calculates the display index for a user/assistant message based on its index in the messagesFormArray.
   * User messages are 1, 2, 3... Assistant messages are 1, 2, 3...
   * @param currentIndexInFormArray The 0-based index of the message group within the messagesFormArray.
   * @returns The display number for the message (e.g., 1 for the first user message, 1 for the first assistant message).
   */
  public getDisplayMessageIndex(currentIndexInFormArray: number): number {
    // The roles alternate 'user', 'assistant', 'user', 'assistant', ...
    // The display index increments for each pair of user/assistant messages.
    // Index 0 (user) -> Display 1
    // Index 1 (assistant) -> Display 1
    // Index 2 (user) -> Display 2
    // Index 3 (assistant) -> Display 2
    // ...
    // Index N -> Display floor(N / 2) + 1
    return Math.floor(currentIndexInFormArray / 2) + 1;
  }


  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
