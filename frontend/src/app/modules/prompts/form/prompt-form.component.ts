import { animate, state, style, transition, trigger } from '@angular/animations';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { CommonModule, Location, TitleCasePipe } from '@angular/common';
import {
	ChangeDetectionStrategy,
	ChangeDetectorRef,
	Component,
	type ElementRef,
	type OnDestroy,
	type OnInit,
	type QueryList,
	ViewChildren,
	inject,
	signal,
} from '@angular/core';
import { type AbstractControl, FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { type MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import type { CallSettings, FilePartExt, ImagePartExt, LlmInfo, LlmMessage, TextPart, UserContentExt, AssistantContentExt } from '#shared/llm/llm.model';
import type { Prompt } from '#shared/prompts/prompts.model';
import { type PromptCreatePayload, PromptGenerateResponseSchemaModel, type PromptSchemaModel, type PromptUpdatePayload } from '#shared/prompts/prompts.schema';
import { LlmService } from '../../llm.service';
import type { Attachment } from '../message.types';
import { attachmentsAndTextToUserContentExt, fileToAttachment, userContentExtToAttachmentsAndText } from '../messageUtil';
import { PromptsService } from '../prompts.service';

import { toObservable } from '@angular/core/rxjs-interop';
import { type Observable, Subject, forkJoin } from 'rxjs';
import { filter, finalize, takeUntil, tap } from 'rxjs/operators';

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
		CdkTextareaAutosize, // Add CdkTextareaAutosize here
		ClipboardModule,
	],
	templateUrl: './prompt-form.component.html',
	styleUrls: ['./prompt-form.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush,
	animations: [
		trigger('summaryFade', [
			transition(':enter', [style({ opacity: 0 }), animate('250ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ opacity: 1 }))]),
			transition(':leave', [animate('250ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ opacity: 0 }))]),
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
	private clipboard = inject(Clipboard);

	private initialNavigationState: { [k: string]: any } | undefined;

	promptForm!: FormGroup;
	isEditMode = signal(false);
	promptIdSignal = signal<string | null>(null); // Renamed to avoid conflict with component property
	isLoading = signal(true);
	isSaving = signal(false);
	isGenerating = signal(false);
	generationResponse = signal<AssistantContentExt | null>(null);
	generationError = signal<string | null>(null);
	private destroy$ = new Subject<void>();
	private llmsState$ = toObservable(this.llmService.llmsState);

	@ViewChildren('fileInput') fileInputs!: QueryList<ElementRef<HTMLInputElement>>;

	tagCtrl = new FormControl('');

	public getAttachmentsFormArray(messageControl: AbstractControl | null): FormArray | null {
		if (messageControl instanceof FormGroup) {
			const attachmentsControl = messageControl.get('attachments');
			if (attachmentsControl instanceof FormArray) {
				return attachmentsControl;
			}
		}
		return null;
	}

	public getMessageContentSummary(messageControl: AbstractControl | null): string {
		const contentValue = messageControl?.value;
		return typeof contentValue === 'string' ? contentValue : '';
	}

	public getTruncatedMessageContentSummary(messageControl: AbstractControl | null, maxLength = 50): string {
		const summary = this.getMessageContentSummary(messageControl);
		if (summary.length > maxLength) {
			return `${summary.slice(0, maxLength)}...`;
		}
		return summary;
	}

	public isLastMessageAssistant(): boolean {
		const messages = this.messagesFormArray;
		if (!messages || messages.length === 0) {
			return false;
		}

		const lastMessage = messages.at(messages.length - 1);
		const lastMessageRole = lastMessage?.get('role')?.value;
		return lastMessageRole === 'assistant';
	}

	readonly separatorKeysCodes: number[] = [13, 188];

	readonly llmMessageRoles: Array<{ value: LlmMessage['role']; viewValue: string }> = [
		{ value: 'system', viewValue: 'System' },
		{ value: 'user', viewValue: 'User' },
		{ value: 'assistant', viewValue: 'Assistant' },
	];

	public selectedModel = '';
	public availableModels: LlmInfo[] = [];

	// Signals for card collapsibility (matching HTML usage)
	optionsCollapsed = signal(false);

	constructor() {}

	public isString(value: any): value is string {
		return typeof value === 'string';
	}

	public isArray(value: any): value is any[] {
		return Array.isArray(value);
	}

	public getImageUrl(part: ImagePartExt): string {
		// If the image data is already a data URL or a web URL, use it directly.
		if (part.image.startsWith('data:') || part.image.startsWith('http')) {
			return part.image;
		}
		// Otherwise, construct a data URL from base64 data and mime type.
		return `data:${part.mimeType || 'image/jpeg'};base64,${part.image}`;
	}

	ngOnInit(): void {
		// Attempt to get navigation state.
		// history.state is generally reliable for state passed via router.navigate.
		const navStateFromHistory = history.state;
		console.log('PromptFormComponent ngOnInit - navStateFromHistory:', navStateFromHistory);

		const currentNavigation = this.router.getCurrentNavigation();
		const navStateFromRouter = currentNavigation?.extras.state;
		console.log('PromptFormComponent ngOnInit - currentNavigation object:', currentNavigation);
		console.log('PromptFormComponent ngOnInit - navStateFromRouter (from currentNavigation.extras.state):', navStateFromRouter);

		// Prioritize state from getCurrentNavigation if it specifically contains our 'llmCallData',
		// otherwise, use history.state if it contains 'llmCallData'.
		if (navStateFromRouter?.llmCallData) {
			this.initialNavigationState = navStateFromRouter;
			console.log('PromptFormComponent ngOnInit - Using initialNavigationState from Router extras.state:', this.initialNavigationState);
		} else if (navStateFromHistory?.llmCallData) {
			// Ensure we are not picking up unrelated state from history by checking for our specific key.
			this.initialNavigationState = navStateFromHistory;
			console.log('PromptFormComponent ngOnInit - Using initialNavigationState from history.state (fallback):', this.initialNavigationState);
		} else {
			this.initialNavigationState = undefined;
			console.log('PromptFormComponent ngOnInit - No "llmCallData" key found in navigation state from either source.');
		}

		// React to LLM state changes
		this.llmsState$
			.pipe(takeUntil(this.destroy$))
			.subscribe((state) => {
				if (state.status === 'success') {
					this.availableModels = state.data.filter((llm) => llm.isConfigured);
				} else if (state.status === 'error') {
					console.error('Failed to load LLMs', state.error);
					this.availableModels = [];
				}

				// Process route data after LLM state is available
				this.processRouteData();
			});
		this.isLoading.set(true);
		// Load LLMs - state changes will be handled by the subscription above
		this.llmService.loadLlms();

		this.promptForm = this.fb.group({
			name: ['', Validators.required],
			tags: this.fb.array([]),
			includeSystemMessage: [false], // Add this line
			messages: this.fb.array([], Validators.minLength(1)),
			options: this.fb.group({
				llmId: [null, Validators.required], // Changed from selectedModel to llmId
				temperature: [1.0, [Validators.required, Validators.min(0), Validators.max(2), Validators.pattern(/^\d*(\.\d+)?$/)]],
				maxOutputTokens: [64000, [Validators.required, Validators.min(1), Validators.max(64000), Validators.pattern(/^[0-9]*$/)]],
			}),
		});

		// After promptForm initialization, subscribe to includeSystemMessage changes
		this.promptForm
			.get('includeSystemMessage')
			?.valueChanges.pipe(takeUntil(this.destroy$))
			.subscribe((include) => {
				const messages = this.messagesFormArray;
				const systemMessageExists = messages.length > 0 && messages.at(0).get('role')?.value === 'system';

				if (include) {
					if (!systemMessageExists) {
						// Add system message at the beginning
						messages.insert(0, this.createMessageGroup('system', ''));
						this.cdr.detectChanges();
					}
				} else {
					if (systemMessageExists) {
						// Remove system message from the beginning
						messages.removeAt(0);
						// If removing the last message and it was the system message, add a default user message
						if (messages.length === 0) {
							this.addMessage('user', ''); // Explicitly add user role here
						}
						this.cdr.detectChanges();
					}
				}
			});
	}

	private processRouteData(): void {
		// Add guard clause to ensure LLMs are loaded
		if (this.availableModels.length === 0) {
			return;
		}

		this.route.data.pipe(takeUntil(this.destroy$)).subscribe((data) => {
			const resolvedPrompt = data.prompt as Prompt | null;
			console.log('processRouteData - resolvedPrompt:', resolvedPrompt);
			// Check for state passed via router navigation (e.g., from LlmCall)
			// Use the captured initialNavigationState
			const llmCallDataForPrompt = this.initialNavigationState?.llmCallData as Partial<Prompt> | undefined;
			console.log('processRouteData - llmCallDataForPrompt from initialNavigationState:', llmCallDataForPrompt);
			if (resolvedPrompt?.id) {
				this.promptIdSignal.set(resolvedPrompt.id);
				this.isEditMode.set(true);
				this.populateForm(resolvedPrompt);
			} else if (llmCallDataForPrompt) {
				// Check for LlmCall data first for "new from LlmCall"
				this.isEditMode.set(false);
				this.promptsService.clearSelectedPrompt(); // Ensure no previous selection interferes
				this.promptIdSignal.set(null); // Explicitly not editing an existing prompt ID

				// Populate form with data from LlmCall
				// populateForm expects a full Prompt, but we can pass a Partial and handle defaults
				this.populateForm(llmCallDataForPrompt as Prompt); // Cast as Prompt, populateForm should handle missing fields gracefully or be adjusted

				// Ensure includeSystemMessage is set based on the messages from LlmCall
				const hasSystemMessage = llmCallDataForPrompt.messages?.some((m) => m.role === 'system');
				this.promptForm.get('includeSystemMessage')?.setValue(!!hasSystemMessage, { emitEvent: true });

				// Set default model if not provided by LlmCall or if provided one is not available
				const optionsLlmId = llmCallDataForPrompt.settings?.llmId;
				if (optionsLlmId && this.availableModels.find((m) => m.id === optionsLlmId)) {
					this.promptForm.get('options.llmId')?.setValue(optionsLlmId, { emitEvent: false });
				} else if (this.availableModels.length > 0) {
					this.promptForm.get('options.llmId')?.setValue(this.availableModels[0].id, { emitEvent: false });
					if (optionsLlmId) {
						console.warn(`LLM ID "${optionsLlmId}" from LlmCall data is not available. Defaulting.`);
					}
				}
			} else {
				// Standard "new prompt" or error case
				if (this.route.snapshot.paramMap.get('promptId') && !resolvedPrompt) {
					console.error('Prompt not found for editing, navigating back.');
					this.router.navigate(['/ui/prompts']).catch(console.error);
					this.isLoading.set(false);
					this.cdr.detectChanges();
					return;
				}
				this.isEditMode.set(false);
				this.promptsService.clearSelectedPrompt();
				this.promptIdSignal.set(null);

				this.promptForm.get('includeSystemMessage')?.setValue(false, { emitEvent: true });

				if (this.messagesFormArray.length === 0) {
					this.addMessage('user', '');
				}

				if (this.availableModels.length > 0) {
					this.promptForm.get('options.llmId')?.setValue(this.availableModels[0].id, { emitEvent: false });
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

	createMessageGroup(role: LlmMessage['role'] = 'user', content = '', attachmentsData: Attachment[] = []): FormGroup {
		return this.fb.group({
			role: [role, Validators.required],
			content: [content, Validators.required],
			attachments: role === 'user' ? this.fb.array(attachmentsData.map((att) => this.fb.control(att))) : this.fb.array([]),
			fullContent: [null as UserContentExt | AssistantContentExt | null], // To preserve complex content
		});
	}

	// Modified signature: role is now optional
	addMessage(role?: LlmMessage['role'], content = '', attachmentsData: Attachment[] = []): void {
		let newRole: LlmMessage['role'];

		if (role) {
			// If a role is explicitly passed (e.g., for initial setup or system message toggle)
			newRole = role;
		} else {
			// Determine role based on the last message if no role is passed (e.g., from the '+' button)
			const messages = this.messagesFormArray;
			if (messages.length === 0) {
				// This case should ideally be handled by initial setup or the toggle listener
				// but as a fallback, default to 'user' if somehow empty and no role is passed.
				newRole = 'user';
			} else {
				const lastMessageGroup = messages.at(messages.length - 1);
				const lastMessageRole = lastMessageGroup.get('role')?.value;

				if (lastMessageRole === 'system' || lastMessageRole === 'assistant') {
					newRole = 'user';
				} else if (lastMessageRole === 'user') {
					newRole = 'assistant';
				} else {
					// Fallback for any unexpected role, though ideally roles are constrained
					newRole = 'user';
				}
			}
		}

		// Special handling for 'system' role (should always be at the beginning and managed by toggle)
		if (newRole === 'system') {
			const systemMessageExistsAtIndex0 = this.messagesFormArray.length > 0 && this.messagesFormArray.at(0).get('role')?.value === 'system';
			if (!systemMessageExistsAtIndex0) {
				this.messagesFormArray.insert(0, this.createMessageGroup(newRole, content, attachmentsData));
			} else {
				console.warn('Attempted to add a system message when one already exists at index 0.');
			}
		} else {
			// Add user/assistant messages to the end
			this.messagesFormArray.push(this.createMessageGroup(newRole, content, attachmentsData));
		}
		this.cdr.detectChanges();
	}

	removeMessage(index: number): void {
		// Prevent removing the system message using this button
		if (this.messagesFormArray.at(index).get('role')?.value === 'system') {
			console.warn('Attempted to remove system message using the remove button.');
			return;
		}
		this.messagesFormArray.removeAt(index);
		// If removing the last non-system message and includeSystemMessage is false, add a default user message
		if (this.messagesFormArray.length === 0 && !this.promptForm.get('includeSystemMessage')?.value) {
			this.addMessage('user', ''); // Explicitly add user role here
		}
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

	private _convertLlmContentToString(content: UserContentExt | AssistantContentExt | undefined): string {
		if (typeof content === 'string') {
			return content;
		}
		if (Array.isArray(content)) {
			return content
				.map((part) => {
					if (part.type === 'text') {
						return (part as TextPart).text;
					}
					if (part.type === 'image') {
						const imagePart = part as ImagePartExt;
						return `[Image: ${imagePart.filename || imagePart.mimeType || 'image'}]`;
					}
					if (part.type === 'file') {
						const filePart = part as FilePartExt;
						return `[File: ${filePart.filename || filePart.mimeType || 'file'}]`;
					}
					// Fallback for any other part types that might appear in UserContentExt if extended
					// Safely access .type, provide a default if it's not a known structure
					const partType = (part as any)?.type || 'unknown';
					return `[Unknown part type: ${partType}]`;
				})
				.join('\n\n'); // Use double newline for better separation of parts in textarea
		}
		return ''; // Handle undefined or null content, or other unexpected types
	}

	populateForm(prompt: Prompt): void {
		const defaultOptions: CallSettings & { llmId?: string | null } = {
			// Changed from selectedModel
			llmId: this.availableModels.length > 0 ? this.availableModels[0].id : null, // Changed from selectedModel
			temperature: 1.0,
			maxOutputTokens: 64000,
		};

		this.promptForm.patchValue(
			{
				name: prompt.name,
			},
			{ emitEvent: false },
		); // Prevent valueChanges from firing prematurely

		const promptOptions = prompt.settings || {};
		let llmIdToPatch = defaultOptions.llmId; // Changed from selectedModelToPatch

		// Use prompt.options.llmId directly
		if (promptOptions.llmId && this.availableModels.find((m) => m.id === promptOptions.llmId)) {
			llmIdToPatch = promptOptions.llmId;
		} else if (promptOptions.llmId) {
			// Prompt has a saved llmId, but it's not in the available list
			console.warn(`Prompt's saved LLM ID "${promptOptions.llmId}" is not available. Defaulting.`);
			// llmIdToPatch will remain defaultOptions.llmId (first available or null)
		}

		const optionsToPatch = {
			...defaultOptions, // provides defaults for temperature, maxOutputTokens
			...promptOptions, // provides saved values from prompt, potentially overriding defaults
			llmId: llmIdToPatch, // ensures llmId is correctly set based on availability
		};
		this.promptForm.get('options')?.patchValue(optionsToPatch, { emitEvent: false });

		this.tagsFormArray.clear();
		(prompt.tags || []).forEach((tag) => this.tagsFormArray.push(this.fb.control(tag)));

		this.messagesFormArray.clear(); // Clear previous messages

		const systemMessages = (prompt.messages || []).filter((msg) => msg.role === 'system');
		const otherMessages = (prompt.messages || []).filter((msg) => msg.role !== 'system');

		let initialIncludeSystemMessage = false;
		let systemMessageContent = '';

		if (systemMessages.length > 0) {
			initialIncludeSystemMessage = true;
			systemMessageContent = this._convertLlmContentToString(systemMessages[0].content as UserContentExt); // Take the content of the first system message
			// Add the system message directly to the array at index 0
			this.messagesFormArray.push(this.createMessageGroup('system', systemMessageContent));
		}

		// Add other messages after the system message (if added)
		otherMessages.forEach((msg) => {
			const contentForTextarea = this._convertLlmContentToString(msg.content as UserContentExt);
			let attachmentsForForm: Attachment[] = [];

			// Only attempt to parse attachments for user messages, as other roles don't have them.
			if (msg.role === 'user') {
				// Safely call the utility. If it returns nothing or lacks an attachments property,
				// attachmentsForForm will remain an empty array, preventing errors.
				const parsed = userContentExtToAttachmentsAndText(msg.content as UserContentExt);
				if (parsed?.attachments) {
					attachmentsForForm = parsed.attachments;
				}
			}

			const messageGroup = this.createMessageGroup(msg.role, contentForTextarea, attachmentsForForm);

			// For any message with complex content (array of parts), store the original content
			// to ensure it's not lost when saving. This is crucial for assistant-generated images.
			if (typeof msg.content !== 'string') {
				messageGroup.get('fullContent')?.setValue(msg.content);
			}

			this.messagesFormArray.push(messageGroup);
		});

		// Set includeSystemMessage form control value *without* emitting event initially
		// The valueChanges listener is primarily for user interaction *after* load.
		this.promptForm.get('includeSystemMessage')?.setValue(initialIncludeSystemMessage, { emitEvent: false });

		// Ensure at least one message editor if the array is empty after population
		// This happens if the prompt had no messages and includeSystemMessage was false
		if (this.messagesFormArray.length === 0) {
			this.addMessage('user', ''); // addMessage handles its own collapsed state, explicitly add user role
		}

		this.isLoading.set(false);
		this.cdr.detectChanges();
	}

	onSubmit(): void {
		if (this.promptForm.invalid) {
			this.promptForm.markAllAsTouched();
			console.warn('Form is invalid:', this.promptForm.errors, this.messagesFormArray.errors);
			// Optionally scroll to the first invalid field
			const firstInvalidControl: HTMLElement = document.querySelector('form .mat-form-field.ng-invalid')!;
			if (firstInvalidControl) {
				firstInvalidControl.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
			return;
		}
		this.isSaving.set(true);
		const formValue = this.promptForm.value;

		// Filter out the includeSystemMessage control value from the payload
		const payloadMessages = formValue.messages.map(
			(formMsg: { role: LlmMessage['role']; content: string; attachments: Attachment[] | null; fullContent: AssistantContentExt | null }) => {
				let messageContentPayload: UserContentExt | AssistantContentExt;

				// Prioritize the preserved fullContent if it exists. This is key for assistant messages with images.
				if (formMsg.fullContent) {
					messageContentPayload = formMsg.fullContent;
				} else if (formMsg.role === 'user' && Array.isArray(formMsg.attachments) && formMsg.attachments.length > 0) {
					// Reconstruct user content from attachments and text if fullContent isn't there.
					messageContentPayload = attachmentsAndTextToUserContentExt(formMsg.attachments, formMsg.content);
				} else {
					// Fallback to simple text content.
					messageContentPayload = formMsg.content;
				}
				return { role: formMsg.role, content: messageContentPayload };
			},
		);

		const payload: PromptCreatePayload | PromptUpdatePayload = {
			name: formValue.name,
			tags: formValue.tags,
			messages: payloadMessages, // Use the filtered messages
			options: formValue.options,
		};

		let operation$: Observable<PromptSchemaModel>;

		if (this.isEditMode() && this.promptIdSignal()) {
			operation$ = this.promptsService.updatePrompt(this.promptIdSignal()!, payload as PromptUpdatePayload);
		} else {
			operation$ = this.promptsService.createPrompt(payload as PromptCreatePayload);
		}

		operation$
			.pipe(
				takeUntil(this.destroy$),
				finalize(() => {
					this.isSaving.set(false);
					this.cdr.detectChanges();
				}),
			)
			.subscribe({
				next: (savedPrompt) => {
					this.router.navigate(['/ui/prompts']).catch(console.error); // Navigate to list, detail view can be next phase
				},
				error: (err) => {
					console.error('Failed to save prompt', err);
				},
			});
	}

	onGenerate(): void {
		if (this.promptForm.invalid) {
			this.promptForm.markAllAsTouched();
			console.warn('Cannot generate, form is invalid.');
			// Optionally scroll to the first invalid field
			const firstInvalidControl: HTMLElement = document.querySelector('form .mat-form-field.ng-invalid')!;
			if (firstInvalidControl) {
				firstInvalidControl.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
			return;
		}

		const formValue = this.promptForm.value;

		const messagesToGenerate: LlmMessage[] = formValue.messages.map((msg: { role: LlmMessage['role']; content: string; attachments: Attachment[] | null }) => {
			let messageContentPayload: UserContentExt;
			if (msg.role === 'user' && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
				messageContentPayload = attachmentsAndTextToUserContentExt(msg.attachments, msg.content);
			} else {
				messageContentPayload = msg.content;
			}
			return { role: msg.role, content: messageContentPayload };
		});

		const generationOptions: CallSettings & { llmId?: string } = formValue.options;

		this.isGenerating.set(true);
		this.generationError.set(null);

		this.promptsService
			.generateFromMessages(messagesToGenerate, generationOptions)
			.pipe(
				takeUntil(this.destroy$),
				finalize(() => {
					this.isGenerating.set(false);
					this.cdr.detectChanges();
				}),
			)
			.subscribe({
				next: (response) => {
					this.generationResponse.set(response.generatedMessage.content as AssistantContentExt);
					this.cdr.detectChanges();
				},
				error: (error) => {
					this.generationError.set(error.message || 'Generation failed');
					this.cdr.detectChanges();
				},
			});
	}

	addResponseToPrompt(): void {
		const responseContent = this.generationResponse();
		if (!responseContent) {
			console.warn('No generated response to add');
			return;
		}

		const contentString = this._convertLlmContentToString(responseContent);

		// Create the group and set fullContent to preserve the original complex response.
		const messageGroup = this.createMessageGroup('assistant', contentString);
		messageGroup.get('fullContent')?.setValue(responseContent);
		this.messagesFormArray.push(messageGroup);

		this.generationResponse.set(null);
		this.generationError.set(null);

		this.cdr.detectChanges();

		console.log('Generated response added to prompt messages');
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
		this.optionsCollapsed.update((v) => !v);
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

	public onDragOver(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
	}

	public async onDrop(event: DragEvent, messageIndex: number): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		const files = Array.from(event.dataTransfer?.files || []);
		if (files.length > 0) {
			const messageGroup = this.messagesFormArray.at(messageIndex) as FormGroup;
			if (messageGroup) {
				const attachmentsArray = this.getAttachmentsFormArray(messageGroup);
				if (attachmentsArray) {
					for (const file of files) {
						const attachment = await fileToAttachment(file);
						attachmentsArray.push(this.fb.control(attachment));
					}
					this.cdr.detectChanges();
				}
			}
		}
	}

	ngOnDestroy(): void {
		this.destroy$.next();
		this.destroy$.complete();
	}

	public copyMessagesAsXml(): void {
        if (!this.promptForm || !this.promptForm.value.messages) {
            console.warn('Prompt form or messages not available for XML export.');
            return;
        }

        const formMessages = this.promptForm.value.messages as Array<{
            role: LlmMessage['role'];
            content: string; // Text content from the textarea
            attachments: Attachment[] | null; // Structured attachment objects
        }>;

        if (formMessages.length === 0) {
            // Optionally, inform the user that there are no messages to copy
            // For now, we can just copy an empty <llm-messages></llm-messages> or do nothing.
            // Let's copy an empty structure if no messages.
            this.clipboard.copy('<llm-messages></llm-messages>');
            // Consider adding a user notification (e.g., toast) here.
            return;
        }

        let xmlString = '<llm-messages>\n';

        for (const formMsg of formMessages) {
            let contentForXml: string;
            if (formMsg.role === 'user' && formMsg.attachments && formMsg.attachments.length > 0) {
                // Ensure attachments are valid before passing to attachmentsAndTextToUserContentExt
                const validAttachments = formMsg.attachments.filter(att => att); // Filter out any null/undefined attachments if that's possible
                const userContentExt = attachmentsAndTextToUserContentExt(validAttachments, formMsg.content);
                contentForXml = this._convertLlmContentToString(userContentExt);
            } else {
                // For system, assistant, or user messages without attachments
                contentForXml = this._convertLlmContentToString(formMsg.content);
            }
            // Escape XML special characters in role if necessary, though 'system', 'user', 'assistant' are safe.
            // Content is wrapped in CDATA, so it doesn't need further escaping.
            xmlString += `  <${formMsg.role}><![CDATA[${contentForXml}]]></${formMsg.role}>\n`;
        }

        xmlString += '</llm-messages>';

        this.clipboard.copy(xmlString);
        // Optionally, add a user notification (e.g., toast) that copy was successful.
        // For example: this.snackBar.open('Messages copied as XML!', 'Close', { duration: 2000 });
        // This would require injecting MatSnackBar. For now, console log for confirmation.
        console.log('Messages copied to clipboard as XML.');
    }

	public async onFileSelected(event: Event, messageIndex: number): Promise<void> {
		const inputElement = event.target as HTMLInputElement;
		if (inputElement.files && inputElement.files.length > 0) {
			const messageGroup = this.messagesFormArray.at(messageIndex) as FormGroup;
			if (messageGroup) {
				const attachmentsArray = this.getAttachmentsFormArray(messageGroup);
				if (attachmentsArray) {
					for (let i = 0; i < inputElement.files.length; i++) {
						const file = inputElement.files[i];
						const attachment = await fileToAttachment(file);
						attachmentsArray.push(this.fb.control(attachment));
					}
					this.cdr.detectChanges();
				}
			}
		}
		// Clear the input value to allow selecting the same file again
		if (inputElement) {
			inputElement.value = '';
		}
	}

	public triggerFileInputClick(index: number): void {
		const inputElement = this.fileInputs.toArray()[index];
		if (inputElement) {
			inputElement.nativeElement.click();
		}
	}

	public removeAttachment(messageIndex: number, attachmentIndex: number): void {
		const messageGroup = this.messagesFormArray.at(messageIndex) as FormGroup;
		if (messageGroup) {
			const attachmentsArray = this.getAttachmentsFormArray(messageGroup);
			if (attachmentsArray) {
				attachmentsArray.removeAt(attachmentIndex);
				this.cdr.detectChanges();
			}
		}
	}
}
