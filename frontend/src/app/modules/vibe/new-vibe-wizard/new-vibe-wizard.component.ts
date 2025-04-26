import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select'; // Import MatSelectModule
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // Import MatProgressSpinnerModule
import { Router } from '@angular/router';
import { VibeService, CreateVibeSessionPayload } from '../vibe.service';
import { VibeSession } from '../vibe.types';
import { WorkflowsService } from '../../workflows/workflows.service'; // Import WorkflowsService
import { GitProject } from '../../../../../../../src/functions/scm/gitProject'; // Adjust path as needed
import { finalize, catchError, tap, startWith, BehaviorSubject, Observable, of } from 'rxjs';

@Component({
	selector: 'app-new-vibe-wizard',
	standalone: true,
	imports: [
		CommonModule,
		ReactiveFormsModule,
		MatFormFieldModule,
		MatInputModule,
		MatButtonModule,
		MatRadioModule,
		MatCheckboxModule,
		MatSelectModule, // Add MatSelectModule
		MatProgressSpinnerModule, // Add MatProgressSpinnerModule
	],
	templateUrl: './new-vibe-wizard.component.html',
	styleUrls: ['./new-vibe-wizard.component.scss'], // Use styleUrls
})
export class NewVibeWizardComponent implements OnInit {
	private fb = inject(FormBuilder);
	private vibeService = inject(VibeService);
	private workflowsService = inject(WorkflowsService); // Inject WorkflowsService
	private router = inject(Router);

	// Form and submission state
	wizardForm!: FormGroup;
	isSubmitting = false;

	// Repository source options
	repoSources: { value: string; label: string }[] = [
		{ value: 'local', label: 'Local Folder' },
		{ value: 'github', label: 'GitHub' },
		{ value: 'gitlab', label: 'GitLab' },
	];

	// State for repository selection
	selectedSource: 'local' | 'github' | 'gitlab' = 'local'; // Default source
	localRepos$: Observable<string[]> = of([]);
	githubProjects: GitProject[] = [];
	gitlabProjects: GitProject[] = [];
	loadingRepos = false;
	repoError: string | null = null;

	// State for branch selection
	private branchesSubject = new BehaviorSubject<string[]>([]);
	branches$: Observable<string[]> = this.branchesSubject.asObservable();
	loadingBranches = false;
	branchError: string | null = null;

	ngOnInit(): void {
		this.wizardForm = this.fb.group({
			title: ['', Validators.required], // Assuming title/instructions are still needed
			instructions: ['', Validators.required], // Assuming title/instructions are still needed
			selectedSource: ['local', Validators.required],
			selectedRepo: [null, Validators.required], // Use null initially, required
			branch: [null, Validators.required], // Use null initially, required
			createNewBranch: [false],
			newBranchName: [null], // Optional, validation handled conditionally if needed
			useSharedRepos: [false, Validators.required],
		});

		// Watch for changes in the source selection
		this.wizardForm.get('selectedSource')?.valueChanges.subscribe((source) => {
			this.selectedSource = source;
			this.onSourceChange();
		});

		// Initial data fetching
		this.fetchRepositories();
	}

	fetchRepositories(): void {
		this.loadingRepos = true;
		this.repoError = null;
		this.localRepos$ = of([]); // Reset local repos
		this.githubProjects = []; // Reset github projects
		this.gitlabProjects = []; // Reset gitlab projects

		// Fetch Local Repositories
		this.localRepos$ = this.workflowsService.getRepositories().pipe(
			catchError((err) => {
				console.error('Error fetching local repositories:', err);
				this.repoError = 'Failed to load local repositories.';
				// Don't stop SCM fetch if local fails
				return of([]); // Return empty array on error
			}),
			// No finalize here, wait for SCM repos too
		);

		// Fetch SCM Repositories (GitHub/GitLab)
		this.vibeService.getScmProjects().pipe(
			finalize(() => this.loadingRepos = false) // Stop loading after SCM fetch completes or errors
		).subscribe({
			next: (projects) => {
				// Assuming project.fullPath contains info to distinguish GitHub/GitLab
				// Adjust this logic if there's a better way to differentiate
				this.githubProjects = projects.filter(p => p.fullPath.includes('github.com') || !p.fullPath.includes('/')); // Basic check
				this.gitlabProjects = projects.filter(p => p.fullPath.includes('gitlab.com') || p.fullPath.includes('/')); // Basic check
			},
			error: (err) => {
				console.error('Error fetching SCM projects:', err);
				this.repoError = (this.repoError ? this.repoError + ' ' : '') + 'Failed to load GitHub/GitLab projects.';
			}
		});
	}


	onSourceChange(): void {
		// Reset repository, branch, and new branch fields when source changes
		this.wizardForm.patchValue({
			selectedRepo: null,
			branch: null,
			createNewBranch: false,
			newBranchName: null,
		});
		this.branchesSubject.next([]); // Clear branches
		this.branchError = null; // Clear branch error
		this.repoError = null; // Clear repo error as we might be switching to a working source
		// Refetch repos if needed, or rely on initial fetch if sources don't change often
		// For simplicity, we assume initial fetch is sufficient unless explicitly refreshed.
	}

	onRepoSelectionChange(): void {
		const selectedRepoValue = this.wizardForm.get('selectedRepo')?.value;

		// Reset branch and new branch fields
		this.wizardForm.patchValue({
			branch: null,
			createNewBranch: false,
			newBranchName: null,
		});
		this.branchesSubject.next([]); // Clear branches
		this.branchError = null; // Clear branch error

		if (!selectedRepoValue) {
			return; // No repository selected
		}

		// Fetch branches only for GitHub/GitLab
		if (this.selectedSource === 'github' || this.selectedSource === 'gitlab') {
			this.loadingBranches = true;
			this.branchError = null;
			const projectId = selectedRepoValue; // The value is the project ID

			this.vibeService.getScmBranches(projectId).pipe(
				finalize(() => this.loadingBranches = false)
			).subscribe({
				next: (branches) => {
					this.branchesSubject.next(branches);
					// Optionally set a default branch if available?
					// const defaultBranch = this.findDefaultBranch(projectId);
					// if (defaultBranch && branches.includes(defaultBranch)) {
					//     this.wizardForm.get('branch')?.setValue(defaultBranch);
					// }
				},
				error: (err) => {
					console.error('Error fetching branches:', err);
					this.branchError = 'Failed to load branches for the selected repository.';
					this.branchesSubject.next([]); // Clear branches on error
				}
			});
		} else if (this.selectedSource === 'local') {
			// For local repos, branch fetching might not be applicable via API
			// Or requires a different endpoint/logic. Assuming no API fetch for now.
			// You might pre-populate with common defaults or leave it manual.
			// For now, let's assume the user types the branch name for local.
			// If an API exists, call it here.
			// Example: Pre-populate with 'main', 'master'
			// this.branchesSubject.next(['main', 'master']);
			// Or leave empty:
			this.branchesSubject.next([]);
		}
	}

	// Helper to find default branch (if needed)
	// findDefaultBranch(projectId: string | number): string | undefined {
	//     const project = [...this.githubProjects, ...this.gitlabProjects].find(p => p.id === projectId);
	//     return project?.defaultBranch;
	// }


	onSubmit(): void {
		// Mark fields as touched to show validation errors
		this.wizardForm.markAllAsTouched();

		if (this.wizardForm.invalid || this.isSubmitting) {
			return; // Prevent submission if form is invalid or already submitting
		}

			return;
		}

		this.isSubmitting = true;
		const formValue = this.wizardForm.value;

		let repositoryId: string = '';
		let repositoryName: string | undefined = undefined;

		if (formValue.selectedSource === 'local') {
			repositoryId = formValue.selectedRepo; // Local path is the ID
			// Extract repo name from path (e.g., last segment)
			const pathParts = repositoryId.split(/[\\/]/); // Split by slash or backslash
			repositoryName = pathParts.pop() || pathParts.pop() || repositoryId; // Get last non-empty part
		} else {
			// For GitHub/GitLab, selectedRepo is the project ID
			const projectId = formValue.selectedRepo;
			const project = [...this.githubProjects, ...this.gitlabProjects].find(p => p.id === projectId);
			if (project) {
				repositoryId = project.id.toString(); // Use project ID as string
				repositoryName = project.name;
			} else {
				console.error('Selected SCM project not found!');
				// Handle error appropriately - maybe show a message to the user
				this.isSubmitting = false;
				return;
			}
		}


		// Construct the payload based on the refactored form
		const payload: CreateVibeSessionPayload = {
			title: formValue.title, // Keep if still needed
			instructions: formValue.instructions, // Keep if still needed
			repositorySource: formValue.selectedSource,
			repositoryId: repositoryId,
			repositoryName: repositoryName || null, // Send null if undefined
			branch: formValue.branch,
			// Only send newBranchName if createNewBranch is true and name is provided
			newBranchName: formValue.createNewBranch && formValue.newBranchName ? formValue.newBranchName : null,
			useSharedRepos: formValue.useSharedRepos,
		};

		this.vibeService
			.createVibeSession(payload)
			.pipe(finalize(() => (this.isSubmitting = false))) // Ensure isSubmitting is reset
			.subscribe({
				next: (createdSession: VibeSession) => {
					console.log('Vibe session created:', createdSession);
					// Navigate to a relevant view, e.g., the session detail or initialization step
					// Using placeholder '/vibe/:id' for now, adjust as needed
					// this.router.navigate(['/vibe', createdSession.id]);
					// Requirement specified '/vibe/initialise/:id', adjust if that route exists/is planned
					this.router.navigate(['/vibe', 'initialise', createdSession.id]);
				},
				error: (err) => {
					console.error('Error creating Vibe session:', err);
					// TODO: Add user-friendly error handling (e.g., snackbar)
				},
			});
	}
}
