import { Component, OnInit, inject, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { PromptsService } from '../prompts.service';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { filter, finalize } from 'rxjs/operators';
import { PromptPreview } from '#shared/model/prompts.model';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { PROMPTS_ROUTES } from '../prompt.paths';

@Component({
  selector: 'app-prompt-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    DatePipe,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './prompt-list.component.html',
  styleUrls: ['./prompt-list.component.scss']
})
export class PromptListComponent implements OnInit {
  private promptsService = inject(PromptsService);
  private confirmationService = inject(FuseConfirmationService);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  prompts = toSignal(this.promptsService.prompts$, { initialValue: null as PromptPreview[] | null });
  isLoading = signal(true);
  isDeletingSignal = signal<string | null>(null); // Tracks ID of prompt being deleted
  displayedColumns: string[] = ['name', 'tags', 'updatedAt', 'actions'];

  public readonly newPromptPath = PROMPTS_ROUTES.new();

  trackByPromptId(index: number, item: PromptPreview): string {
    return item.id;
  }

  ngOnInit(): void {
    this.promptsService.refreshPrompts().pipe(
      finalize(() => this.isLoading.set(false))
    ).subscribe({
       error: (err) => console.error('Failed to load prompts', err)
    });
  }

  refreshPrompts(): void {
    if (this.isLoading()) {
        return;
    }
    this.isLoading.set(true);
    this.cdr.detectChanges();
    this.promptsService.refreshPrompts().pipe(
        finalize(() => {
            this.isLoading.set(false);
            this.cdr.detectChanges();
        })
    ).subscribe({
        next: () => {
            console.log('Prompts refreshed');
            this.snackBar.open('Prompts list refreshed.', 'Close', { duration: 2000 });
        },
        error: (err) => {
            console.error('Error refreshing prompts', err);
            this.snackBar.open('Error refreshing prompts list.', 'Close', { duration: 3000 });
        }
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

  editPrompt(promptId: string): void {
      this.router.navigate(PROMPTS_ROUTES.edit(promptId)).catch(console.error);
  }
}
