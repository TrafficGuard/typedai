import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, type OnInit, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterModule } from '@angular/router';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { filter, finalize } from 'rxjs/operators';
import type { PromptPreview } from '#shared/prompts/prompts.model';
import { PROMPTS_ROUTES } from '../prompt.paths';
// import { toSignal } from '@angular/core/rxjs-interop'; // No longer needed for prompts
import { PromptsService } from '../prompts.service';

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
		MatSnackBarModule,
	],
	templateUrl: './prompt-list.component.html',
	styleUrls: ['./prompt-list.component.scss'],
})
export class PromptListComponent implements OnInit {
	private promptsService = inject(PromptsService);
	private confirmationService = inject(FuseConfirmationService);
	private cdr = inject(ChangeDetectorRef);
	private router = inject(Router);
	private snackBar = inject(MatSnackBar);

	readonly promptsState = this.promptsService.promptsState;

	prompts = computed<PromptPreview[] | null>(() => {
		const state = this.promptsState();
		return state.status === 'success' ? state.data : null;
	});

	isLoading = computed(() => {
		const state = this.promptsState();
		return state.status === 'loading' || state.status === 'idle';
	});

	isError = computed(() => this.promptsState().status === 'error');
	errorDetails = computed(() => {
		const state = this.promptsState();
		return state.status === 'error' ? state.error : null;
	});

	private refreshInitiated = signal(false);
	isDeletingSignal = signal<string | null>(null); // Tracks ID of prompt being deleted
	displayedColumns: string[] = ['name', 'tags', 'updatedAt', 'actions'];

	public readonly newPromptPath = PROMPTS_ROUTES.new();

	trackByPromptId(index: number, item: PromptPreview): string {
		return item.id;
	}

	constructor() {
		effect(
			() => {
				const state = this.promptsState();
				if (this.refreshInitiated()) {
					if (state.status === 'success') {
						this.snackBar.open('Prompts list refreshed.', 'Close', { duration: 2000 });
						this.refreshInitiated.set(false);
					} else if (state.status === 'error') {
						const errorMessage = state.error?.message || 'Unknown error';
						this.snackBar.open(`Error refreshing prompts: ${errorMessage}`, 'Close', { duration: 3000, panelClass: ['error-snackbar'] });
						this.refreshInitiated.set(false);
					}
				}
			},
			{ allowSignalWrites: true },
		);
	}

	ngOnInit(): void {
		// The PromptsService constructor already calls loadPrompts.
		// Calling refreshPrompts() here ensures that if the component is initialized
		// after the initial load, or if we want a fresh fetch on init, it happens.
		// It sets state to 'idle' then 'loading'.
		this.promptsService.refreshPrompts();
	}

	refreshPrompts(): void {
		if (this.isLoading()) {
			// isLoading is now a computed signal
			return;
		}
		this.refreshInitiated.set(true);
		this.promptsService.refreshPrompts();
		// No manual isLoading.set() or cdr.detectChanges() needed here,
		// computed signals and effects handle reactivity.
	}

	deletePrompt(event: MouseEvent, prompt: PromptPreview): void {
		event.stopPropagation();

		this.confirmationService
			.open({
				title: 'Delete Prompt',
				message: `Are you sure you want to delete "${prompt.name}"? This action cannot be undone.`,
				actions: {
					confirm: {
						label: 'Delete',
						color: 'warn',
					},
				},
			})
			.afterClosed()
			.pipe(filter((status) => status === 'confirmed'))
			.subscribe(() => {
				this.isDeletingSignal.set(prompt.id);
				this.cdr.detectChanges();
				this.promptsService
					.deletePrompt(prompt.id)
					.pipe(
						finalize(() => {
							this.isDeletingSignal.set(null);
							this.cdr.detectChanges();
						}),
					)
					.subscribe({
						next: () => {
							console.log(`Prompt "${prompt.name}" deleted successfully.`);
						},
						error: (err) => {
							console.error(`Error deleting prompt "${prompt.name}":`, err);
						},
					});
			});
	}

	editPrompt(promptId: string): void {
		this.router.navigate(PROMPTS_ROUTES.edit(promptId)).catch(console.error);
	}
}
