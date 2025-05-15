import { Component, OnInit, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common'; // Add DatePipe
import { RouterModule } from '@angular/router';
import { PromptsService } from '../prompts.service';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip'; // For tooltips
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // For loading
import { filter, finalize } from 'rxjs/operators';
import { PromptPreview } from '#shared/model/prompts.model';
import { FuseConfirmationService } from '@fuse/services/confirmation';


@Component({
  selector: 'app-prompt-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    DatePipe, // Add DatePipe
    MatListModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './prompt-list.component.html',
  styleUrls: ['./prompt-list.component.scss']
})
export class PromptListComponent implements OnInit {
  private promptsService = inject(PromptsService);
  private confirmationService = inject(FuseConfirmationService);
  private cdr = inject(ChangeDetectorRef);

  prompts = this.promptsService.prompts;
  isLoading = signal(true);
  isDeletingSignal = signal<string | null>(null); // Tracks ID of prompt being deleted

  ngOnInit(): void {
    this.promptsService.loadPrompts().pipe(
      finalize(() => this.isLoading.set(false))
    ).subscribe({
       error: (err) => console.error('Failed to load prompts', err)
    });
  }

  deletePrompt(event: MouseEvent, prompt: PromptPreview): void {
    event.stopPropagation();

    this.confirmationService.open({
        title: 'Delete Prompt',
        message: `Are you sure you want to delete "${prompt.name}"? This action cannot be undone.`,
        actions: {
            confirm: {
                label: 'Delete',
                color: 'warn',
            },
        },
    }).afterClosed().pipe(
        filter(status => status === 'confirmed')
    ).subscribe(() => {
        this.isDeletingSignal.set(prompt.id);
        this.cdr.detectChanges();
        this.promptsService.deletePrompt(prompt.id).pipe(
            finalize(() => {
                this.isDeletingSignal.set(null);
                this.cdr.detectChanges();
            })
        ).subscribe({
            next: () => {
                console.log(`Prompt "${prompt.name}" deleted successfully.`);
            },
            error: (err) => {
                console.error(`Error deleting prompt "${prompt.name}":`, err);
            }
        });
    });
  }
}
