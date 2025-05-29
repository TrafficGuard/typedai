import { CommonModule } from '@angular/common';
import { Component, type OnDestroy, type OnInit, ViewEncapsulation, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialogModule } from '@angular/material/dialog';
import { MatAccordion, MatExpansionPanel, MatExpansionPanelDescription, MatExpansionPanelHeader, MatExpansionPanelTitle } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { Observable, Subject, finalize, map, startWith, switchMap, take, takeUntil, tap } from 'rxjs';
import { CodeTask } from '#shared/codeTask/codeTask.model';
import type { FileSystemNode } from '#shared/files/fileSystemService';
import { CodeTaskServiceClient } from './codeTask.service';
import { FileSelection } from './designReview/designFileSelection/fileSelection';

@Component({
	selector: 'codeTask-detail',
	templateUrl: './codeTask.component.html',
	styleUrls: ['./codeTask.component.scss'],
	encapsulation: ViewEncapsulation.None,
	standalone: true,
	imports: [
		CommonModule,
		ReactiveFormsModule,
		MatFormFieldModule,
		MatSelectModule,
		MatIconModule,
		MatCardModule,
		MatProgressBarModule,
		MatInputModule,
		MatButtonModule,
		MatListModule,
		MatTooltipModule,
		MatAutocompleteModule,
		FileSelection,
		MatProgressSpinnerModule,
		MatDialogModule,
		MatAccordion,
		MatExpansionPanel,
		MatExpansionPanelDescription,
		MatExpansionPanelHeader,
		MatExpansionPanelTitle,
	],
})
export class CodeTaskComponent implements OnInit, OnDestroy {
	private destroy$ = new Subject<void>();

	fileUpdateInstructionsControl = new FormControl('');
	// Full list of files available in the codeTask's workspace
	rootNode: FileSystemNode;
	allFiles: string[] = [];
	// filteredFiles$: Observable<string[]>; // Removed

	private codeTaskService = inject(CodeTaskServiceClient);
	private route = inject(ActivatedRoute);
	private snackBar = inject(MatSnackBar);

	readonly codeTaskState = this.codeTaskService.currentCodeTaskState;

	// Observable for backward compatibility with template
	readonly codeTask$ = this.codeTaskService.currentCodeTask$;

	// Computed property for current codeTask
	readonly currentCodeTask = computed(() => {
		const state = this.codeTaskState();
		return state.status === 'success' ? state.data : null;
	});

	isProcessingAction = false;
	private codeTaskId: string | null = null;

	ngOnInit() {
		this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
			this.codeTaskId = params.get('id');
			if (this.codeTaskId) {
				this.codeTaskService.loadCodeTask(this.codeTaskId);
			} else {
				console.error('Code Task ID not found in route parameters');
			}
		});
	}

	ngOnDestroy(): void {
		this.destroy$.next();
		this.destroy$.complete();
	}

	public handleSelectionResetRequested(): void {
		const codeTask = this.currentCodeTask();
		if (!codeTask) {
			console.error('CodeTaskComponent: Cannot handle selection reset, currentCodeTask is null.');
			this.snackBar.open('Error: CodeTask data not available.', 'Close', { duration: 3000 });
			return;
		}
		if (this.isProcessingAction) {
			console.warn('CodeTaskComponent: Action already in progress, reset request ignored.');
			this.snackBar.open('Please wait, another action is in progress.', 'Close', { duration: 3000 });
			return;
		}

		console.log(`CodeTaskComponent: Selection reset requested for codeTask ID: ${codeTask.id}.`);
		this.isProcessingAction = true;

		this.codeTaskService
			.resetFileSelection(codeTask.id)
			.pipe(
				take(1), // Ensure the subscription is automatically unsubscribed after one emission
				finalize(() => {
					this.isProcessingAction = false;
				}),
				takeUntil(this.destroy$), // Ensure cleanup on component destruction
			)
			.subscribe({
				next: () => {
					console.log(`CodeTaskComponent: File selection reset successfully initiated for codeTask ${codeTask.id}.`);
					this.snackBar.open('File selection reset successfully. CodeTask will refresh.', 'Close', { duration: 3500 });
					// The codeTask should ideally refresh via the existing polling/SSE mechanism in getCodeTask
					// or by explicitly calling getCodeTask if needed.
				},
				error: (err) => {
					console.error(`CodeTaskComponent: Error resetting file selection for codeTask ${codeTask.id}:`, err);
					this.snackBar.open(`Error resetting file selection: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000 });
				},
			});
	}
}
