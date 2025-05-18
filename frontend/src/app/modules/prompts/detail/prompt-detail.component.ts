import { Component, OnInit, inject, signal, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, computed } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
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
import { TextFieldModule } from '@angular/cdk/text-field';

import { PromptsService } from '../prompts.service';
import type { Prompt } from '#shared/model/prompts.model';
import { type LlmMessage, type ImagePartExt, type FilePartExt, messageText } from '#shared/model/llm.model';
import type { Attachment } from 'app/modules/message.types';
import { Subject } from 'rxjs';
import { takeUntil, tap, finalize, filter } from 'rxjs/operators';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { PROMPTS_ROUTES } from '../prompt.paths';

// Interface for processed messages with attachments for UI display
interface DisplayablePromptMessage extends LlmMessage {
  textContentForDisplay: string;
  uiImageAttachments?: Attachment[];
  uiFileAttachments?: Attachment[];
}

@Component({
  selector: 'app-prompt-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    // Angular Forms
    FormsModule,
    ReactiveFormsModule,
    // Angular Material (alphabetized)
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
    // Angular CDK
    TextFieldModule
  ],
  templateUrl: './prompt-detail.component.html',
  styleUrls: ['./prompt-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptDetailComponent implements OnInit, OnDestroy {
  private promptsService = inject(PromptsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private cdr = inject(ChangeDetectorRef);
  private confirmationService = inject(FuseConfirmationService);

  prompt = this.promptsService.selectedPrompt;
  isLoading = signal(true);
  isDeletingSignal = signal(false);
  private destroy$ = new Subject<void>();

  processedMessages = computed(() => {
    const currentPrompt = this.prompt();
    if (!currentPrompt || !currentPrompt.messages) {
      return [] as DisplayablePromptMessage[];
    }
    return currentPrompt.messages.map(msg => this.processMessageForDisplay(msg));
  });

  private processMessageForDisplay(apiLlmMessage: LlmMessage): DisplayablePromptMessage {
    const uiImageAttachments: Attachment[] = [];
    const uiFileAttachments: Attachment[] = [];

    if (Array.isArray(apiLlmMessage.content)) {
      for (const part of apiLlmMessage.content) {
        if (part.type === 'image') {
          const imagePart = part as ImagePartExt;
          const imgPreviewUrl = imagePart.externalURL ||
                                (typeof imagePart.image === 'string' && imagePart.image.length > 0
                                  ? `data:${imagePart.mimeType || 'image/png'};base64,${imagePart.image}`
                                  : undefined);

          if (imgPreviewUrl) {
            uiImageAttachments.push({
              type: 'image',
              filename: imagePart.filename || `image_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`,
              size: imagePart.size || 0,
              data: null, 
              mimeType: imagePart.mimeType || 'image/png',
              previewUrl: imgPreviewUrl,
            });
          }
        } else if (part.type === 'file') {
          const filePart = part as FilePartExt;
          const filePreviewUrl = filePart.externalURL;

          uiFileAttachments.push({
            type: 'file',
            filename: filePart.filename || `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            size: filePart.size || 0,
            data: null,
            mimeType: filePart.mimeType || 'application/octet-stream',
            previewUrl: filePreviewUrl,
          });
        }
      }
    }

    const textContentForDisplay = messageText(apiLlmMessage);

    return {
      ...apiLlmMessage,
      textContentForDisplay,
      uiImageAttachments: uiImageAttachments.length > 0 ? uiImageAttachments : undefined,
      uiFileAttachments: uiFileAttachments.length > 0 ? uiFileAttachments : undefined,
    };
  }

  ngOnInit(): void {
    this.isLoading.set(true);
    this.route.data.pipe(
        takeUntil(this.destroy$),
        tap(data => {
            const resolvedPrompt = data['prompt'] as Prompt | null;
            if (!resolvedPrompt && this.route.snapshot.paramMap.get('promptId')) {
                console.error('Prompt not found by resolver, navigating to list.');
                this.router.navigate(PROMPTS_ROUTES.list()).catch(console.error);
            }
            // The promptsService.selectedPrompt signal should have been updated by the resolver
            // if data['prompt'] is not null.
        }),
        finalize(() => {
             this.isLoading.set(false);
             this.cdr.detectChanges();
        })
    ).subscribe();
  }

  editPrompt(): void {
    if (this.prompt()?.id) { // Ensure prompt is loaded
      this.router.navigate(PROMPTS_ROUTES.editRelative(), { relativeTo: this.route }).catch(console.error);
    }
  }

  goBack(): void {
    this.location.back();
  }

  deleteCurrentPrompt(): void {
    const currentPrompt = this.prompt();
    if (!currentPrompt) {
        return;
    }

    this.confirmationService.open({
        title: 'Delete Prompt',
        message: `Are you sure you want to delete "${currentPrompt.name}"? This action cannot be undone.`,
        actions: {
            confirm: {
                label: 'Delete',
                color: 'warn',
            },
        },
    }).afterClosed().pipe(
        filter(status => status === 'confirmed')
    ).subscribe(() => {
        this.isDeletingSignal.set(true);
        this.cdr.detectChanges();
        this.promptsService.deletePrompt(currentPrompt.id).pipe(
            finalize(() => {
                this.isDeletingSignal.set(false);
                this.cdr.detectChanges();
            })
        ).subscribe({
            next: () => {
                console.log(`Prompt "${currentPrompt.name}" deleted successfully.`);
                this.router.navigate(PROMPTS_ROUTES.list()).catch(console.error);
            },
            error: (err) => {
                console.error(`Error deleting prompt "${currentPrompt.name}":`, err);
            }
        });
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
