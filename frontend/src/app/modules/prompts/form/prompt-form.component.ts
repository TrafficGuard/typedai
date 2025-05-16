import { Component, OnInit, inject, signal, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule, FormControl } from '@angular/forms';
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
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';


import { PromptsService } from '../prompts.service';
import type { Prompt } from '#shared/model/prompts.model'; // Ensure Prompt is imported directly
import type { LlmMessage, GenerateOptions } from '#shared/model/llm.model';
import type { PromptCreatePayload, PromptUpdatePayload, PromptSchemaModel } from '#shared/schemas/prompts.schema';

import { Subject, Observable } from 'rxjs';
import { takeUntil, finalize, tap, filter } from 'rxjs/operators';

@Component({
  selector: 'app-prompt-form',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
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
    MatTooltipModule
  ],
  templateUrl: './prompt-form.component.html',
  styleUrls: ['./prompt-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptFormComponent implements OnInit, OnDestroy {
  private promptsService = inject(PromptsService);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private cdr = inject(ChangeDetectorRef);

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

  ngOnInit(): void {
    this.promptForm = this.fb.group({
      name: ['', Validators.required],
      tags: this.fb.array([]),
      messages: this.fb.array([], Validators.minLength(1)),
      options: this.fb.group({
        temperature: [1.0, [Validators.min(0), Validators.max(2), Validators.pattern(/^\d*(\.\d+)?$/)]],
        maxTokens: [2048, [Validators.min(1), Validators.pattern(/^[1-9]\d*$/)]],
      }),
    });

    this.route.data.pipe(
    takeUntil(this.destroy$)
    ).subscribe(data => {
        const resolvedPrompt = data['prompt'] as Prompt | null;
        if (resolvedPrompt && resolvedPrompt.id) { // Check if id exists
            this.promptIdSignal.set(resolvedPrompt.id);
            this.isEditMode.set(true);
            this.populateForm(resolvedPrompt);
        } else {
            if (this.route.snapshot.paramMap.get('promptId') && !resolvedPrompt) {
                console.error('Prompt not found for editing, navigating back.');
                this.router.navigate(['/ui/prompts']).catch(console.error);
                return;
            }
            this.isEditMode.set(false);
            this.promptsService.clearSelectedPrompt();
            this.addMessage('user', ''); // Add one initial user message
        }
        this.isLoading.set(false);
        this.cdr.detectChanges(); // Trigger change detection after async data loading
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
    this.cdr.detectChanges();
  }

  removeMessage(index: number): void {
    this.messagesFormArray.removeAt(index);
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
    this.promptForm.patchValue({
      name: prompt.name,
      options: prompt.options || { temperature: 1.0, maxTokens: 2048 }, // Provide defaults for options
    });

    this.tagsFormArray.clear();
    (prompt.tags || []).forEach(tag => this.tagsFormArray.push(this.fb.control(tag)));

    this.messagesFormArray.clear();
    (prompt.messages || []).forEach(msg => this.messagesFormArray.push(this.createMessageGroup(msg.role, msg.content as string)));

    if (this.messagesFormArray.length === 0) {
        this.addMessage('user', ''); // Ensure at least one message editor
    }
    this.isLoading.set(false);
    this.cdr.detectChanges();
  }

  onSubmit(): void {
    if (this.promptForm.invalid) {
      this.promptForm.markAllAsTouched();
      console.warn('Form is invalid:', this.promptForm.errors, this.messagesFormArray.errors);
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

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
