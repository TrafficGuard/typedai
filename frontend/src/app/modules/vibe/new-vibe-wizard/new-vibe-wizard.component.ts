import { CommonModule } from '@angular/common';
import { Component, type OnDestroy, type OnInit, inject } from '@angular/core';
import {
	type AbstractControl,
	type AsyncValidatorFn,
	FormBuilder,
	type FormGroup,
	ReactiveFormsModule,
	type ValidationErrors,
	Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { BehaviorSubject, type Observable, Subscription, catchError, finalize, map, of, take } from 'rxjs';
import { type CreateVibeSessionPayload, VibeServiceClient } from '../vibe-service-client.service';
import { MatCard, MatCardContent } from '@angular/material/card';
import {GitProject} from "#shared/model/git.model";
import {VibePreset, VibePresetConfig, VibeSession} from "#shared/model/vibe.model";

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
		MatSelectModule,
		MatProgressSpinnerModule,
		MatCard,
		MatCardContent,
		MatSnackBarModule,
		MatSelectModule, // Import MatSelectModule
	],
	templateUrl: './new-vibe-wizard.component.html',
	styleUrls: ['./new-vibe-wizard.component.scss'],
})
export class NewVibeWizardComponent implements OnInit, OnDestroy {
	private fb = inject(FormBuilder);
	private vibeService = inject(VibeServiceClient);
	private router = inject(Router);
	private snackBar = inject(MatSnackBar); // Inject MatSnackBar

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
	// selectedSource: 'local' | 'github' | 'gitlab' = 'local'; // Default source - REMOVED, use form value directly
	localRepos$: Observable<string[]> = of([]);
	githubProjects: GitProject[] = [];
	gitlabProjects: GitProject[] = [];
	loadingRepos = false;
	repoError: string | null = null;

	// State for branch selection
	branchesSubject = new BehaviorSubject<string[]>([]);
	branches$: Observable<string[]> = this.branchesSubject.asObservable();
	loadingBranches = false;
	branchError: string | null = null;

	// State for presets
	presets$: Observable<VibePreset[]> = of([]);
	loadingPresets = false;
	presetError: string | null = null;

	private formSubscriptions = new Subscription(); // To manage subscriptions

	ngOnInit(): void {
		this.wizardForm = this.fb.group({
			title: ['', Validators.required],
			instructions: ['', Validators.required],
			selectedSource: ['local', Validators.required],
			selectedRepo: [null, Validators.required],
			targetBranch: [null, Validators.required],
			// Default to 'new', add 'target' option
			workingBranchAction: ['new', Validators.required], // 'target', 'existing', or 'new'
			// Remove 'workingBranch' control - it will be derived in onSubmit
			// workingBranch: [null],
			// Add control for selecting an existing branch
			existingWorkingBranch: [null], // Required only if workingBranchAction === 'existing'
			newWorkingBranchName: [null], // Required only if workingBranchAction === 'new'
			useSharedRepos: [false, Validators.required],
		});

		// Initial setup for working branch based on action
		this.updateWorkingBranchValidators(); // Set initial validators

		// Initially disable useSharedRepos if the source is 'local'
		const useSharedReposControlInitial = this.wizardForm.get('useSharedRepos');
		if (useSharedReposControlInitial && this.wizardForm.get('selectedSource')?.value === 'local') {
			useSharedReposControlInitial.disable({ emitEvent: false });
		}

		// Watch for changes in the source selection
		const sourceChanges = this.wizardForm.get('selectedSource')?.valueChanges.subscribe(() => {
			// The ngSwitch now directly uses the form value, just call the handler
			this.onSourceChange();

			// Enable/disable useSharedRepos based on the new source
			const newSource = this.wizardForm.get('selectedSource')?.value;
			const useSharedReposControl = this.wizardForm.get('useSharedRepos');
			if (useSharedReposControl) {
				if (newSource === 'local') {
					useSharedReposControl.disable({ emitEvent: false });
				} else {
					useSharedReposControl.enable({ emitEvent: false });
				}
			}
		});
		this.formSubscriptions.add(sourceChanges!); // Add to subscriptions

		// Watch for changes in the selected repository to fetch branches and update controls
		const repoChanges = this.wizardForm.get('selectedRepo')?.valueChanges.subscribe(() => {
			this.onRepoSelectionChange(); // Fetch branches and reset related fields
		});
		this.formSubscriptions.add(repoChanges!); // Add to subscriptions

		// Watch for changes in the working branch action to update validators
		const actionChanges = this.wizardForm.get('workingBranchAction')?.valueChanges.subscribe(() => {
			this.updateWorkingBranchValidators();
		});
		this.formSubscriptions.add(actionChanges!); // Add to subscriptions

		// Initial data fetching
		this.fetchRepositories();
		this.loadPresets(); // Load presets on init
		// Set initial branch control state (now handled within onRepoSelectionChange/updateWorkingBranchValidators)
	}

	ngOnDestroy(): void {
		this.formSubscriptions.unsubscribe(); // Clean up subscriptions
	}

	fetchRepositories(): void {
		this.loadingRepos = true;
		this.repoError = null;
		this.localRepos$ = of([]); // Reset local repos
		this.githubProjects = []; // Reset github projects
		this.gitlabProjects = []; // Reset gitlab projects

		// Fetch Local Repositories
		this.localRepos$ = this.vibeService.getRepositories().pipe(
			catchError((err) => {
				console.error('Error fetching local repositories:', err);
				this.repoError = 'Failed to load local repositories.';
				// Don't stop SCM fetch if local fails
				return of([]); // Return empty array on error
			}),
			// No finalize here, wait for SCM repos too
		);

		// Fetch SCM Repositories (GitHub/GitLab)
		this.vibeService
			.getScmProjects()
			.pipe(
				finalize(() => {
					this.loadingRepos = false;
				}), // Stop loading after SCM fetch completes or errors
			)
			.subscribe({
				// Add type annotation to projects for clarity
				next: (projects: GitProject[]) => {
					this.githubProjects = projects.filter((p) => p.type === 'github');
					this.gitlabProjects = projects.filter((p) => p.type === 'gitlab');
					console.log(`Loaded ${this.githubProjects.length} GitHub projects and ${this.gitlabProjects.length} GitLab projects`);

					const unclassifiedCount = projects.length - this.githubProjects.length - this.gitlabProjects.length;
					if (unclassifiedCount > 0) {
						console.warn(`Received ${unclassifiedCount} SCM projects that could not be classified as GitHub or GitLab based on fullPath.`);
					}
				},
				error: (err) => {
					console.error('Error fetching SCM projects:', err);
					// Combine potential errors
					const scmError = 'Failed to load GitHub/GitLab projects.';
					this.repoError = this.repoError ? `${this.repoError} ${scmError}` : scmError;
				},
			});
	}

	loadPresets(): void {
		this.loadingPresets = true;
		this.presetError = null;
		this.presets$ = this.vibeService.listVibePresets().pipe(
			catchError((err) => {
				console.error('Error loading presets:', err);
				this.presetError = 'Failed to load presets.';
				return of([]); // Return empty array on error
			}),
			finalize(() => {
				this.loadingPresets = false;
			}),
		);
	}

	onSourceChange(): void {
		// Reset repository and ALL branch-related fields
		this.wizardForm.patchValue({
			selectedRepo: null,
			targetBranch: null,
			workingBranchAction: 'new', // Reset to default 'new'
			existingWorkingBranch: null, // Reset new control
			newWorkingBranchName: null,
		});
		this.branchesSubject.next([]); // Clear branches
		this.branchError = null; // Clear branch error
		this.repoError = null; // Clear repo error
		this.updateWorkingBranchValidators(); // Reset validators
		// Refetch repos if needed, or rely on initial fetch.
	}

	onRepoSelectionChange(): void {
		const selectedRepo: GitProject | string | null = this.wizardForm.get('selectedRepo')?.value;

		// Reset target branch and working branch fields
		this.wizardForm.patchValue({
			targetBranch: null,
			workingBranchAction: 'new', // Reset to default 'new'
			existingWorkingBranch: null, // Reset new control
			newWorkingBranchName: null,
		});
		this.branchesSubject.next([]); // Clear branches
		this.branchError = null; // Clear branch error
		this.updateWorkingBranchValidators(); // Reset validators

		if (!selectedRepo) {
			return; // No repository selected
		}

		const currentSource = this.wizardForm.get('selectedSource')?.value;

		// Fetch branches for SCM repos
		if ((currentSource === 'github' || currentSource === 'gitlab') && typeof selectedRepo === 'object' && selectedRepo !== null) {
			this.loadingBranches = true;
			this.branchError = null;

			const providerType = selectedRepo.type;
			const projectId = selectedRepo.id; // Use the numeric ID

			this.vibeService
				.getScmBranches(providerType, projectId)
				.pipe(
					finalize(() => {
						this.loadingBranches = false;
						this.updateWorkingBranchValidators(); // Re-evaluate validators after loading
					}),
				)
				.subscribe({
					next: (branches) => {
						this.branchesSubject.next(branches);
						// Set default target branch if possible (e.g., project's default)
						const defaultBranch = (selectedRepo as GitProject)?.defaultBranch;
						if (defaultBranch && branches.includes(defaultBranch)) {
							this.wizardForm.get('targetBranch')?.setValue(defaultBranch);
						}
					},
					error: (err) => {
						console.error('Error fetching SCM branches:', err);
						this.branchError = 'Failed to load branches for the selected repository.';
						this.branchesSubject.next([]); // Clear branches on error
					},
				});
		} else if (this.wizardForm.get('selectedSource')?.value === 'local') {
			// For local repos, branch fetching might not be applicable via API
			// Or requires a different endpoint/logic. Assuming no API fetch for now.
			// You might pre-populate with common defaults or leave it manual.
			// For now, let's assume the user types the branch name for local.
			// If an API exists, call it here.
			// Example: Pre-populate with 'main', 'master'
			// this.branchesSubject.next(['main', 'master']);
			// Or leave empty for local:
			this.branchesSubject.next([]);
			this.updateWorkingBranchValidators(); // Update state even for local
		}
	}

	// Validator Factory for checking existing branches
	private existingBranchValidator(): AsyncValidatorFn {
		return (control: AbstractControl): Observable<ValidationErrors | null> => {
			const branchName = control.value;
			if (!branchName) {
				return of(null); // Don't validate empty value
			}
			return this.branches$.pipe(
				take(1), // Take the current list of branches
				map((branches) => {
					const exists = branches.some((b) => b.toLowerCase() === branchName.toLowerCase());
					return exists ? { branchExists: true } : null;
				}),
			);
		};
	}

	// Update validators based on working branch action and source type
	updateWorkingBranchValidators(): void {
		const action = this.wizardForm.get('workingBranchAction')?.value;
		const targetBranchControl = this.wizardForm.get('targetBranch');
		const existingWorkingBranchControl = this.wizardForm.get('existingWorkingBranch'); // Get new control
		const newWorkingBranchControl = this.wizardForm.get('newWorkingBranchName');
		const selectedRepoValue = this.wizardForm.get('selectedRepo')?.value;
		const currentSource = this.wizardForm.get('selectedSource')?.value; // Get current source

		if (!targetBranchControl || !existingWorkingBranchControl || !newWorkingBranchControl) return;

		// Reset validators first
		targetBranchControl.clearValidators();
		existingWorkingBranchControl.clearValidators(); // Reset new control
		newWorkingBranchControl.clearValidators();
		newWorkingBranchControl.clearAsyncValidators();

		// Common required validator for targetBranch
		targetBranchControl.setValidators(Validators.required);

		// --- Enable/Disable and set validators based on action ---
		if (action === 'target') {
			// No extra fields needed, disable others
			existingWorkingBranchControl.disable();
			newWorkingBranchControl.disable();
			existingWorkingBranchControl.setValue(null, { emitEvent: false }); // Clear value silently
			newWorkingBranchControl.setValue(null, { emitEvent: false }); // Clear value silently
		} else if (action === 'existing') {
			// Need existing branch selection
			existingWorkingBranchControl.setValidators(Validators.required);
			existingWorkingBranchControl.enable(); // Enable the dropdown/input
			newWorkingBranchControl.disable();
			newWorkingBranchControl.setValue(null, { emitEvent: false }); // Clear value silently
		} else {
			// action === 'new'
			// Need new branch name input
			// action === 'new'
			// Need new branch name input
			newWorkingBranchControl.setValidators(Validators.required);
			// Only add async validator for SCM sources
			if (currentSource !== 'local') {
				newWorkingBranchControl.setAsyncValidators(this.existingBranchValidator());
			}
			newWorkingBranchControl.enable();
			existingWorkingBranchControl.disable();
			existingWorkingBranchControl.setValue(null, { emitEvent: false }); // Clear value silently
		}
		// --- End Enable/Disable ---

		// --- Enable/Disable Target Branch and Existing Branch based on repo/loading state (for SCM) ---
		if (currentSource === 'local') {
			targetBranchControl.enable(); // Always enabled for local
			// Also enable existing branch input if action is 'existing' for local
			if (action === 'existing') existingWorkingBranchControl.enable();
			else existingWorkingBranchControl.disable(); // Disable if not 'existing'
		} else {
			// GitHub or GitLab
			if (!selectedRepoValue || this.loadingBranches) {
				targetBranchControl.disable();
				// Also disable existing branch dropdown if branches are loading/no repo
				existingWorkingBranchControl.disable();
			} else {
				targetBranchControl.enable();
				// Re-enable existing branch dropdown if action is 'existing' and branches loaded
				if (action === 'existing') existingWorkingBranchControl.enable();
				else existingWorkingBranchControl.disable(); // Disable if not 'existing'
			}
			// New branch name input enabling/disabling is handled within the action block above
		}
		// --- End Target/Existing Branch Enable/Disable ---

		// Update validity to reflect changes
		targetBranchControl.updateValueAndValidity({ emitEvent: false });
		existingWorkingBranchControl.updateValueAndValidity({ emitEvent: false }); // Update new control
		newWorkingBranchControl.updateValueAndValidity({ emitEvent: false });
	}

	applyPreset(preset: VibePreset): void {
		if (!preset) return;
		console.log('Applying preset:', preset);

		const config = preset.config;

		// Patch the form with preset config
		this.wizardForm.patchValue({
			// Omit title and instructions
			selectedSource: config.repositorySource,
			// selectedRepo needs special handling below
			targetBranch: config.targetBranch,
			// Determine workingBranchAction based on config
			workingBranchAction: config.createWorkingBranch ? 'new' : config.workingBranch === config.targetBranch ? 'target' : 'existing',
			existingWorkingBranch: !config.createWorkingBranch && config.workingBranch !== config.targetBranch ? config.workingBranch : null,
			newWorkingBranchName: config.createWorkingBranch ? config.workingBranch : null,
			useSharedRepos: config.useSharedRepos,
		});

		// Handle selectedRepo based on source
		let repoToSelect: GitProject | string | null = null;
		if (config.repositorySource === 'local') {
			repoToSelect = config.repositoryId; // Local uses path as ID
		} else {
			// Find the matching SCM project object
			const projects = config.repositorySource === 'github' ? this.githubProjects : this.gitlabProjects;
			repoToSelect = projects.find((p) => p.id.toString() === config.repositoryId) || null;

			if (!repoToSelect) {
				this.snackBar.open(`Preset Warning: Could not find the saved ${config.repositorySource} repository (${config.repositoryName || config.repositoryId}). Please select it manually.`, 'Close', { duration: 7000, verticalPosition: 'top' });
				// Reset repo field to force manual selection
				this.wizardForm.get('selectedRepo')?.setValue(null);
			}
		}

		// Set the selectedRepo value (might be null if not found)
		this.wizardForm.get('selectedRepo')?.setValue(repoToSelect);

		// Trigger branch loading AFTER patching the form, especially selectedRepo
		// Use setTimeout to ensure patchValue completes before triggering change detection/branch loading
		setTimeout(() => {
			this.onRepoSelectionChange();
		}, 0);
	}

	savePreset(): void {
		this.wizardForm.markAllAsTouched();
		if (this.wizardForm.invalid) {
			this.snackBar.open('Cannot save preset: Form is invalid.', 'Close', { duration: 3000, verticalPosition: 'top' });
			return;
		}

		const presetName = window.prompt('Enter a name for this preset:');
		if (!presetName) {
			return; // User cancelled
		}

		this.isSubmitting = true; // Use submitting flag to disable button
		const formValue = this.wizardForm.value;

		// --- Logic to derive repo ID/Name (copied from onSubmit) ---
		let repositoryId = '';
		let repositoryName: string | undefined | null = undefined;

		if (formValue.selectedSource === 'local') {
			repositoryId = formValue.selectedRepo as string;
			const pathParts = repositoryId.split(/[\\/]/);
			repositoryName = pathParts.pop() || pathParts.pop() || repositoryId;
		} else {
			const selectedProject = formValue.selectedRepo as GitProject;
			if (selectedProject && typeof selectedProject === 'object') {
				repositoryId = selectedProject.id.toString();
				repositoryName = selectedProject.name;
			} else {
				this.snackBar.open('Cannot save preset: Invalid repository selection.', 'Close', { duration: 5000, verticalPosition: 'top' });
				this.isSubmitting = false;
				return;
			}
		}
		// --- End Repo ID/Name Logic ---

		// --- Logic to derive working branch/create flag (copied from onSubmit) ---
		let workingBranch: string;
		let createWorkingBranch: boolean;

		switch (formValue.workingBranchAction) {
			case 'target':
				workingBranch = formValue.targetBranch;
				createWorkingBranch = false;
				break;
			case 'existing':
				workingBranch = formValue.existingWorkingBranch;
				createWorkingBranch = false;
				break;
			case 'new':
				workingBranch = formValue.newWorkingBranchName;
				createWorkingBranch = true;
				break;
			default:
				this.snackBar.open('Cannot save preset: Invalid working branch option.', 'Close', { duration: 5000, verticalPosition: 'top' });
				this.isSubmitting = false;
				return;
		}
		// --- End Working Branch Logic ---

		// Construct the preset config payload (Omit title and instructions)
		const config: VibePresetConfig = {
			repositorySource: formValue.selectedSource,
			repositoryId: repositoryId,
			repositoryName: repositoryName || null,
			targetBranch: formValue.targetBranch,
			workingBranch: workingBranch,
			createWorkingBranch: createWorkingBranch,
			useSharedRepos: formValue.useSharedRepos,
		};

		console.log('Saving Preset Config:', config);

		this.vibeService
			.saveVibePreset(presetName, config)
			.pipe(
				finalize(() => {
					this.isSubmitting = false;
				}),
			)
			.subscribe({
				next: (savedPreset) => {
					this.snackBar.open(`Preset "${savedPreset.name}" saved successfully!`, 'Close', { duration: 3000, verticalPosition: 'top' });
					this.loadPresets(); // Refresh the preset list
				},
				error: (err) => {
					this.snackBar.open(`Error saving preset: ${err.message || 'Unknown error'}`, 'Close', { duration: 5000, verticalPosition: 'top' });
					console.error('Error saving preset:', err);
				},
			});
	}

	onSubmit(): void {
		this.wizardForm.markAllAsTouched();

		// Log form state for debugging
		console.log('Form Validity:', this.wizardForm.valid);
		console.log('Form Value:', this.wizardForm.value);
		Object.keys(this.wizardForm.controls).forEach((key) => {
			const control = this.wizardForm.get(key);
			console.log(`Control: ${key}, Valid: ${control?.valid}, Errors:`, control?.errors);
		});

		if (this.wizardForm.invalid || this.isSubmitting) {
			console.error('Form is invalid or submission in progress.');
			return; // Prevent submission
		}

		this.isSubmitting = true;
		const formValue = this.wizardForm.value;

		let repositoryId = '';
		let repositoryName: string | undefined | null = undefined;

		if (formValue.selectedSource === 'local') {
			repositoryId = formValue.selectedRepo as string; // Local path is the ID (string)
			// Extract repo name from path (e.g., last segment)
			const pathParts = repositoryId.split(/[\\/]/); // Split by slash or backslash
			repositoryName = pathParts.pop() || pathParts.pop() || repositoryId; // Get last non-empty part
		} else {
			// For GitHub/GitLab, selectedRepo is the GitProject object
			const selectedProject = formValue.selectedRepo as GitProject; // Cast to GitProject
			if (selectedProject && typeof selectedProject === 'object') {
				repositoryId = selectedProject.id.toString(); // Use project ID as string
				repositoryName = selectedProject.name; // Use project name
			} else {
				console.error('Selected SCM project object not found or invalid in form value!');
				this.repoError = 'Invalid repository selection. Please re-select the repository.';
				this.isSubmitting = false;
				return;
			}
		}
		// --- End Repository ID/Name Logic ---

		// Determine working branch name and creation flag based on the action
		let workingBranch: string;
		let createWorkingBranch: boolean;

		switch (formValue.workingBranchAction) {
			case 'target':
				workingBranch = formValue.targetBranch;
				createWorkingBranch = false;
				break;
			case 'existing':
				workingBranch = formValue.existingWorkingBranch; // Use the new control value
				createWorkingBranch = false;
				break;
			case 'new':
				workingBranch = formValue.newWorkingBranchName;
				createWorkingBranch = true;
				break;
			default:
				// Should not happen with validation, but handle defensively
				console.error('Invalid workingBranchAction:', formValue.workingBranchAction);
				this.isSubmitting = false;
				return;
		}

		// Construct the payload
		const payload: CreateVibeSessionPayload = {
			title: formValue.title,
			instructions: formValue.instructions,
			repositorySource: formValue.selectedSource,
			repositoryFullPath: repositoryId,
			repositoryName: repositoryName || null,
			targetBranch: formValue.targetBranch,
			workingBranch: workingBranch, // Use the derived value
			createWorkingBranch: createWorkingBranch, // Use the derived value
			useSharedRepos: formValue.useSharedRepos,
		};

		// Log the payload before sending
		console.log('Submitting Vibe Session Payload:', payload);

		this.vibeService
			.createVibeSession(payload)
			.pipe(
				finalize(() => {
					this.isSubmitting = false;
				}),
			) // Ensure isSubmitting is reset
			.subscribe({
				next: (createdSession: VibeSession) => {
					console.log('Vibe session created:', createdSession);
					this.router.navigate(['/ui/vibe', createdSession.id]);
				},
				error: (err) => {
					this.snackBar.open(`Error creating Vibe session: ${err.message || 'Unknown error'}`, 'Close', {
						duration: 5000, // Show for 5 seconds
						verticalPosition: 'top', // Position at the top
					});
					console.error('Error creating Vibe session:', err); // Keep the console log for developer debugging purposes
				},
			});
	}
}
