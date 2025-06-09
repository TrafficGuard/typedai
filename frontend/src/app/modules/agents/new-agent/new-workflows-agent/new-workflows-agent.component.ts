import { CommonModule } from '@angular/common';
import { Component, DestroyRef, type OnInit, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, type FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { WorkflowsService } from './workflows.service';

@Component({
	selector: 'new-workflows-agent',
	templateUrl: './new-workflows-agent.component.html',
	styleUrls: ['./new-workflows-agent.component.scss'],
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
	],
})
export class NewWorkflowsAgentComponent implements OnInit {
	codeForm!: FormGroup;
	result = '';
	isLoading = false;

	private destroyRef = inject(DestroyRef);

	// Add computed signals for repositories state
	private repositoriesData = computed(() => {
		const state = this.workflowsService.repositoriesState();
		if (state.status === 'success') {
			return state.data;
		}
		return [];
	});

	private repositoriesError = computed(() => {
		const state = this.workflowsService.repositoriesState();
		return state.status === 'error' ? state.error : null;
	});

	repositories = computed(() => this.repositoriesData());

	constructor(
		private fb: FormBuilder,
		private workflowsService: WorkflowsService,
	) {
		// Handle form patching side effect
		toObservable(this.repositoriesData)
			.pipe(takeUntilDestroyed(this.destroyRef))
			.subscribe((repositories) => {
				if (repositories.length > 0 && this.codeForm) {
					this.codeForm.patchValue({ workingDirectory: repositories[0] });
				}
			});

		// Handle error side effects
		toObservable(this.repositoriesError)
			.pipe(
				filter((error) => error !== null),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((error) => {
				console.error('Error fetching repositories:', error);
				this.result = `Error fetching repositories: ${error.message}. Please try again later.`;
			});
	}

	ngOnInit() {
		this.codeForm = this.fb.group({
			workingDirectory: ['', Validators.required],
			workflowType: ['code', Validators.required],
			input: ['', Validators.required],
		});

		this.workflowsService.loadRepositories();
	}

	getInputLabel(): string {
		const workflowType = this.codeForm.get('workflowType')?.value;
		switch (workflowType) {
			case 'code':
				return 'Requirements';
			case 'query':
				return 'Query';
			case 'selectFiles':
				return 'Requirements for File Selection';
			default:
				return 'Input';
		}
	}

	onSubmit() {
		console.log(`valid ${this.codeForm.valid}`);
		if (this.codeForm.valid) {
			this.isLoading = true;
			this.executeOperation();
		}
	}

	/**
	 * Executes the selected operation based on the form input.
	 * This method handles different operation types and calls the appropriate service method.
	 * It also manages the loading state and error handling for all operations.
	 */
	private executeOperation() {
		const { workingDirectory, workflowType, input } = this.codeForm.value;

		let operation: Observable<any>;

		switch (workflowType) {
			case 'code':
				operation = this.workflowsService.runCodeEditorImplementRequirements(workingDirectory, input);
				break;
			case 'query':
				operation = this.workflowsService.runCodebaseQuery(workingDirectory, input);
				break;
			case 'selectFiles':
				operation = this.workflowsService.selectFilesToEdit(workingDirectory, input);
				break;
			default:
				this.result = 'Error: Invalid operation type';
				this.isLoading = false;
				return;
		}

		operation.subscribe({
			next: (response: any) => {
				this.result = workflowType === 'query' ? response.response : JSON.stringify(response, null, 2);
				this.isLoading = false;
			},
			error: (error: Error) => {
				console.error(`Error in ${workflowType} operation:`, error);
				this.result = `Error during ${workflowType} operation: ${error.message}`;
				this.isLoading = false;
			},
		});
	}
}
