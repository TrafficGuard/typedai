import { SelectionModel } from '@angular/cdk/collections';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, type OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import type { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import { CodeReviewServiceClient } from '../code-review.service';

@Component({
	selector: 'app-codeReview-list',
	templateUrl: './code-review-list.component.html',
	standalone: true,
	imports: [
		CommonModule,
		MatButtonModule,
		MatIconModule,
		MatCheckboxModule,
		// MatToolbarModule, // Not used
		MatTableModule,
		MatProgressSpinnerModule,
		MatProgressBarModule, // Use MatProgressBarModule
		MatTooltipModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeReviewListComponent implements OnInit {
	private codeReviewService = inject(CodeReviewServiceClient);
	private router = inject(Router);
	private dialog = inject(FuseConfirmationService);
	private snackBar = inject(MatSnackBar);
	private destroyRef = inject(DestroyRef);

	configsState = this.codeReviewService.configsState;
	configs = computed(() => {
		const state = this.configsState();
		return state.status === 'success' ? state.data : [];
	});
	selection = new SelectionModel<CodeReviewConfig>(true, []);
	displayedColumns = signal<string[]>(['title', 'description', 'enabled', 'select']);
	isLoading = computed(() => this.configsState().status === 'loading');
	errorMessage = computed(() => {
		const state = this.configsState();
		return state.status === 'error' ? 'Error loading configurations' : '';
	});

	ngOnInit() {
		this.loadConfigs();
	}

	loadConfigs() {
		this.codeReviewService.getCodeReviewConfigs();
		this.selection.clear();
	}

	openEditPage(id?: string) {
		if (id) {
			this.router.navigate(['/ui/code-reviews/edit', id]).catch(console.error);
		} else {
			this.router.navigate(['/ui/code-reviews/new']).catch(console.error);
		}
	}

	isAllSelected(): boolean {
		const numSelected = this.selection.selected.length;
		const numRows = this.configs().length;
		return numRows > 0 && numSelected === numRows;
	}

	masterToggle(): void {
		this.isAllSelected() ? this.selection.clear() : this.configs().forEach((row) => this.selection.select(row));
	}

	deleteSelectedConfigs(): void {
		const selectedIds = this.selection.selected.map((config) => config.id);
		if (selectedIds.length === 0) {
			this.snackBar.open('No configurations selected for deletion', 'Close', { duration: 3000 });
			return;
		}

		this.dialog
			.open({
				title: 'Confirm Deletion',
				message: `Are you sure you want to delete ${selectedIds.length} configuration(s)?`,
				actions: {
					confirm: {
						show: true,
						label: 'Delete',
						color: 'warn',
					},
					cancel: {
						show: true,
						label: 'Cancel',
					},
				},
			})
			.afterClosed()
			.subscribe((result) => {
				if (result === 'confirmed') {
					this.codeReviewService
						.deleteCodeReviewConfigs(selectedIds)
						.pipe(takeUntilDestroyed(this.destroyRef))
						.subscribe({
							next: () => {
								this.snackBar.open('Configurations deleted successfully', 'Close', { duration: 3000 });
								this.selection.clear();
							},
							error: (err) => {
								this.snackBar.open('Error deleting configurations', 'Close', { duration: 3000 });
								console.error('Error deleting configurations:', err);
							},
						});
				}
			});
	}

	refreshConfigs(): void {
		this.codeReviewService.refreshConfigs();
		this.snackBar.open('Configurations list refreshed.', 'Close', { duration: 2000 });
		this.selection.clear();
	}
}
