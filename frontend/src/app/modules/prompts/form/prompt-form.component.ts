import { Component, OnInit, inject, signal, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location, TitleCasePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { trigger, state, style, transition, animate } from '@angular/animations'; // Ensure state is imported
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
            state('visible', style({
                opacity: 1,
                height: '*', // Auto height when visible
                overflow: 'hidden'
            })),
            state('hidden', style({
                opacity: 0,
                height: '0px', // Collapse height when hidden
                overflow: 'hidden'
            })),
            // Transition when the summary becomes visible (e.g., panel collapses)
            transition('hidden => visible', [
                animate('250ms cubic-bezier(0.4, 0.0, 0.2, 1)')
            ]),
            // Transition when the summary becomes hidden (e.g., panel expands)
            transition('visible => hidden', [
                animate('250ms cubic-bezier(0.4, 0.0, 0.2, 1)')
            ]),
            // This :leave transition is for cases where the element hosting @summaryFade
            // is actually removed from the DOM (e.g., a message item in an *ngFor is deleted).
            transition(':leave', [
                // Animate from whatever its current style is to the 'hidden' style
                animate('250ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ opacity: 0, height: '0px' }))
            ])
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
        {value: 'system', viewValue: 'System'},
        {value: 'user', viewValue: 'User'},
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
            messages: this.fb.array([], Validators.minLength(1)),
            options: this.fb.group({
                llmId: [null, Validators.required], // Changed from selectedModel to llmId
                temperature: [1.0, [Validators.required, Validators.min(0), Validators.max(2), Validators.pattern(/^\d*(\.\d+)?$/)]],
                maxOutputTokens: [2048, [Validators.required, Validators.min(1), Validators.max(8192), Validators.pattern(/^[0-9]*$/)]],
            }),
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
                this.addMessage('user', ''); // Add one initial user message
                // Set default model if creating new and models are available
                if (this.availableModels.length > 0) {
                    this.promptForm.get('options.llmId')?.setValue(this.availableModels[0].id); // Changed from selectedModel
                }
            }
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
        return this.fb.group({
            role: [role, Validators.required],
            content: [content, Validators.required],
        });
    }

    addMessage(role: LlmMessage['role'] = 'user', content: string = ''): void {
        this.messagesFormArray.push(this.createMessageGroup(role, content));
        // messageItemCollapsedStates logic removed
        this.cdr.detectChanges();
    }

    removeMessage(index: number): void {
        this.messagesFormArray.removeAt(index);
        // messageItemCollapsedStates logic removed
        this.cdr.detectChanges();
    }

    addTagFromInput(event: MatChipInputEvent): void {
        const value = (event.value || '').trim();
        if (value) {
            this.tagsFormArray.push(this.fb.control(value));
            this.cdr.detectChanges();
        }
        if (event.chipInput) {
            event.chipInput.clear();
        }
        this.tagCtrl.setValue(null); // Reset the input control
    }

    removeTagAtIndex(index: number): void {
        this.tagsFormArray.removeAt(index);
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
        });

        const promptOptions = prompt.options || {};
        let llmIdToPatch = defaultOptions.llmId; // Changed from selectedModelToPatch

        // Use prompt.options.llmId directly
        if (promptOptions.llmId && this.availableModels.find(m => m.id === promptOptions.llmId)) {
            llmIdToPatch = promptOptions.llmId;
        } else if (promptOptions.llmId) {
            // Prompt has a saved llmId, but it's not in the available list
            console.warn(`Prompt's saved LLM ID "${promptOptions.llmId}" is not available. Defaulting.`);
            // llmIdToPatch will remain defaultOptions.llmId (first available or null)
        }

        const optionsToPatch = {
            ...defaultOptions, // provides defaults for temperature, maxOutputTokens
            ...promptOptions,   // provides saved values from prompt, potentially overriding defaults
            llmId: llmIdToPatch // ensures llmId is correctly set based on availability
        };
        this.promptForm.get('options')?.patchValue(optionsToPatch);

        this.tagsFormArray.clear();
        (prompt.tags || []).forEach(tag => this.tagsFormArray.push(this.fb.control(tag)));

        this.messagesFormArray.clear();
        // messageItemCollapsedStates logic removed
        (prompt.messages || []).forEach(msg => {
            this.messagesFormArray.push(this.createMessageGroup(msg.role, msg.content as string));
            // messageItemCollapsedStates logic removed
        });
        // messageItemCollapsedStates logic removed


        if (this.messagesFormArray.length === 0) {
            this.addMessage('user', ''); // Ensure at least one message editor, addMessage handles its own collapsed state
        }
        this.isLoading.set(false);
        this.cdr.detectChanges();
    }

    onSubmit(): void {
        if (this.promptForm.invalid) {
            this.promptForm.markAllAsTouched();
            console.warn('Form is invalid:', this.promptForm.errors, this.messagesFormArray.errors);
            // Optionally scroll to the first invalid field
            const firstInvalidControl: HTMLElement = document.querySelector(
                'form .mat-form-field.ng-invalid'
            )!;
            if (firstInvalidControl) {
                firstInvalidControl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }
        this.isSaving.set(true);
        const formValue = this.promptForm.value;

        const payload: PromptCreatePayload | PromptUpdatePayload = {
            name: formValue.name,
            tags: formValue.tags,
            messages: formValue.messages.map((msg: {role: LlmMessage['role'], content: string}) => ({role: msg.role, content: msg.content})),
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
                this.router.navigate(['/ui/prompts']).catch(console.error); // Navigate to list, detail view can be next phase
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


    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }
}
