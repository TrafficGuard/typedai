import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { VibeService } from '../vibe.service';
import { WorkflowsService } from '../../workflows/workflows.service';
import type { GitProject, VibePreset, VibePresetConfig, VibeSession } from '../vibe.types'; // Import necessary types
import { MatSelectModule } from '@angular/material/select'; // Import MatSelectModule

import { NewVibeWizardComponent } from './new-vibe-wizard.component';
import { Validators } from '@angular/forms';

// Use jest types for mocking if available in the execution environment, otherwise use basic spies
declare var jest: any;

describe('NewVibeWizardComponent', () => {
	let component: NewVibeWizardComponent;
	let fixture: ComponentFixture<NewVibeWizardComponent>;
	let vibeService: VibeService;
	let workflowsService: WorkflowsService;
	let snackBar: MatSnackBar;
	let router: Router;

	// Mock services using jest.fn()
	// Mock services using jest.fn()
	const mockVibeService = {
		createVibeSession: jest.fn(),
		getScmProjects: jest.fn().mockReturnValue(of([])),
		getScmBranches: jest.fn().mockReturnValue(of([])),
		listVibePresets: jest.fn().mockReturnValue(of([])), // Add preset methods
		saveVibePreset: jest.fn(),
		deleteVibePreset: jest.fn(),
	};
	const mockWorkflowsService = {
		getRepositories: jest.fn().mockReturnValue(of([])),
	};

	// Mock data
	const mockLocalRepos = ['/path/to/repo1', '/path/to/repo2'];
	const mockGithubProjects: GitProject[] = [
		{
			id: 1,
			name: 'github-repo1',
			namespace: 'org1',
			fullPath: 'org1/github-repo1',
			description: 'Desc 1',
			defaultBranch: 'main',
			type: 'github',
			host: 'github.com',
			visibility: 'public',
			archived: false,
		},
	];
	const mockGitlabProjects: GitProject[] = [
		{
			id: 2,
			name: 'gitlab-repo1',
			namespace: 'group1',
			fullPath: 'group1/gitlab-repo1',
			description: 'Desc 2',
			defaultBranch: 'master',
			type: 'gitlab',
			host: 'gitlab.com',
			visibility: 'private',
			archived: false,
		},
	];
	const mockBranches = ['main', 'develop', 'feature/new-thing'];
	const mockCreatedSession: VibeSession = {
		id: 'session-123',
		title: 'Test Title',
		status: 'initializing',
		instructions: 'Test Instructions',
		repositorySource: 'local',
		repositoryId: '/local/path',
		repositoryName: 'path',
		branch: 'main', // Note: Backend uses 'branch' for targetBranch in the response model
		useSharedRepos: false,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const mockPresets: VibePreset[] = [
		{
			id: 'preset-1',
			userId: 'user-1',
			name: 'Local Main Preset',
			config: {
				repositorySource: 'local',
				repositoryId: '/local/path/preset',
				repositoryName: 'preset',
				targetBranch: 'main',
				workingBranch: 'feature/preset-branch',
				createWorkingBranch: true,
				useSharedRepos: false,
			},
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		{
			id: 'preset-2',
			userId: 'user-1',
			name: 'GitHub Develop Preset',
			config: {
				repositorySource: 'github',
				repositoryId: '1', // Matches mockGithubProjects[0].id
				repositoryName: 'github-repo1',
				targetBranch: 'develop',
				workingBranch: 'develop', // Use existing branch
				createWorkingBranch: false,
				useSharedRepos: true,
			},
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	];

	beforeEach(async () => {
		// Reset mocks before each test
		mockVibeService.createVibeSession.mockReset();
		mockVibeService.getScmProjects.mockReset().mockReturnValue(of([]));
		mockVibeService.getScmBranches.mockReset().mockReturnValue(of([]));
		mockVibeService.listVibePresets.mockReset().mockReturnValue(of([])); // Reset preset mock
		mockVibeService.saveVibePreset.mockReset();
		mockWorkflowsService.getRepositories.mockReset().mockReturnValue(of([]));

		await TestBed.configureTestingModule({
			imports: [NewVibeWizardComponent, MatSnackBarModule, MatSelectModule], // Add MatSelectModule
			providers: [
				provideHttpClient(),
				provideHttpClientTesting(),
				provideNoopAnimations(),
				provideRouter([]),
				{ provide: VibeService, useValue: mockVibeService },
				{ provide: WorkflowsService, useValue: mockWorkflowsService },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(NewVibeWizardComponent);
		component = fixture.componentInstance;
		vibeService = TestBed.inject(VibeService);
		workflowsService = TestBed.inject(WorkflowsService); // Inject WorkflowsService
		snackBar = TestBed.inject(MatSnackBar);
		router = TestBed.inject(Router); // Inject Router
		// DO NOT call fixture.detectChanges() here; call it inside tests or describe blocks after setup
	});

	it('should create', () => {
		fixture.detectChanges(); // Trigger ngOnInit
		expect(component).toBeTruthy();
	});

	describe('Form Initialization (ngOnInit)', () => {
		beforeEach(() => {
			// Setup mocks for ngOnInit calls
			mockWorkflowsService.getRepositories.mockReturnValue(of(mockLocalRepos));
			mockVibeService.getScmProjects.mockReturnValue(of([...mockGithubProjects, ...mockGitlabProjects]));
			fixture.detectChanges(); // Trigger ngOnInit
		});

		it('should create the wizardForm', () => {
			expect(component.wizardForm).toBeDefined();
		});

		it('should set initial default values', () => {
			expect(component.wizardForm.get('selectedSource')?.value).toBe('local');
			expect(component.wizardForm.get('workingBranchAction')?.value).toBe('new');
			expect(component.wizardForm.get('useSharedRepos')?.value).toBe(false);
		});

		it('should set initial required validators', () => {
			expect(component.wizardForm.get('title')?.hasValidator(Validators.required)).toBe(true);
			expect(component.wizardForm.get('instructions')?.hasValidator(Validators.required)).toBe(true);
			expect(component.wizardForm.get('selectedSource')?.hasValidator(Validators.required)).toBe(true);
			expect(component.wizardForm.get('selectedRepo')?.hasValidator(Validators.required)).toBe(true);
			expect(component.wizardForm.get('targetBranch')?.hasValidator(Validators.required)).toBe(true);
			// workingBranchAction is required by default
			expect(component.wizardForm.get('workingBranchAction')?.hasValidator(Validators.required)).toBe(true);
			// newWorkingBranchName is required when action is 'new' (default)
			expect(component.wizardForm.get('newWorkingBranchName')?.hasValidator(Validators.required)).toBe(true);
			// existingWorkingBranch is not required initially
			expect(component.wizardForm.get('existingWorkingBranch')?.hasValidator(Validators.required)).toBe(false);
		});

		it('should initially disable useSharedRepos when source is local', () => {
			expect(component.wizardForm.get('useSharedRepos')?.disabled).toBe(true);
		});

		it('should call repository fetching methods', () => {
			expect(workflowsService.getRepositories).toHaveBeenCalledTimes(1);
			expect(vibeService.getScmProjects).toHaveBeenCalledTimes(1);
			expect(vibeService.listVibePresets).toHaveBeenCalledTimes(1); // Check preset loading
		});

		it('should populate repository lists on successful fetch', (done) => {
			component.localRepos$.subscribe((repos) => {
				expect(repos).toEqual(mockLocalRepos);
				done();
			});
			expect(component.githubProjects).toEqual(mockGithubProjects);
			expect(component.gitlabProjects).toEqual(mockGitlabProjects);
			expect(component.loadingRepos).toBe(false); // Should be false after fetch completes
			expect(component.repoError).toBeNull();
		});

		it('should handle errors during repository fetching', () => {
			// Reset and setup error mocks
			mockWorkflowsService.getRepositories.mockReset().mockReturnValue(throwError(() => new Error('Local fetch failed')));
			mockVibeService.getScmProjects.mockReset().mockReturnValue(throwError(() => new Error('SCM fetch failed')));

			// Re-run ngOnInit by creating a new component instance or re-triggering
			fixture = TestBed.createComponent(NewVibeWizardComponent);
			component = fixture.componentInstance;
			fixture.detectChanges(); // Trigger ngOnInit again

			expect(component.loadingRepos).toBe(false);
			expect(component.repoError).toContain('Failed to load local repositories.');
			expect(component.repoError).toContain('Failed to load GitHub/GitLab projects.');
		});
	});

	describe('Source Change', () => {
		beforeEach(() => {
			fixture.detectChanges(); // Initial setup
			// Set initial state to something other than default to test reset
			component.wizardForm.patchValue({
				selectedSource: 'github',
				selectedRepo: mockGithubProjects[0],
				targetBranch: 'main',
				workingBranchAction: 'existing',
				existingWorkingBranch: 'develop',
				newWorkingBranchName: null,
				useSharedRepos: true,
			});
			component.branchesSubject.next(['main', 'develop']);
			component.branchError = 'Some branch error';
			component.repoError = 'Some repo error';
			fixture.detectChanges();
		});

		it('should reset fields and clear errors when source changes', () => {
			component.wizardForm.get('selectedSource')?.setValue('local');
			fixture.detectChanges();

			expect(component.wizardForm.get('selectedRepo')?.value).toBeNull();
			expect(component.wizardForm.get('targetBranch')?.value).toBeNull();
			expect(component.wizardForm.get('workingBranchAction')?.value).toBe('new'); // Resets to default
			expect(component.wizardForm.get('existingWorkingBranch')?.value).toBeNull();
			expect(component.wizardForm.get('newWorkingBranchName')?.value).toBeNull();
			expect(component.branchesSubject.value).toEqual([]);
			expect(component.branchError).toBeNull();
			expect(component.repoError).toBeNull();
		});

		it('should disable useSharedRepos when source changes to local', () => {
			component.wizardForm.get('selectedSource')?.setValue('local');
			fixture.detectChanges();
			expect(component.wizardForm.get('useSharedRepos')?.disabled).toBe(true);
		});

		it('should enable useSharedRepos when source changes to github', () => {
			component.wizardForm.get('selectedSource')?.setValue('local'); // Start local
			fixture.detectChanges();
			component.wizardForm.get('selectedSource')?.setValue('github'); // Change to github
			fixture.detectChanges();
			expect(component.wizardForm.get('useSharedRepos')?.enabled).toBe(true);
		});
	});

	describe('Repository Selection Change', () => {
		beforeEach(() => {
			mockVibeService.getScmBranches.mockReturnValue(of(mockBranches));
			fixture.detectChanges(); // Initial setup
			component.wizardForm.get('selectedSource')?.setValue('github');
			fixture.detectChanges();
		});

		it('should reset branch fields before fetching', () => {
			// Set some initial branch values
			component.wizardForm.patchValue({
				targetBranch: 'develop',
				workingBranchAction: 'existing',
				existingWorkingBranch: 'develop',
			});
			component.branchesSubject.next(['develop']);
			component.branchError = 'Old error';
			fixture.detectChanges();

			// Act: Select a repo
			component.wizardForm.get('selectedRepo')?.setValue(mockGithubProjects[0]);
			fixture.detectChanges(); // Trigger valueChanges

			// Assert: Fields are reset before async fetch completes
			expect(component.wizardForm.get('targetBranch')?.value).toBeNull();
			expect(component.wizardForm.get('workingBranchAction')?.value).toBe('new');
			expect(component.wizardForm.get('existingWorkingBranch')?.value).toBeNull();
			expect(component.wizardForm.get('newWorkingBranchName')?.value).toBeNull();
			expect(component.branchesSubject.value).toEqual([]); // Cleared immediately
			expect(component.branchError).toBeNull(); // Cleared immediately
		});

		it('should fetch branches when an SCM repo is selected', fakeAsync(() => {
			component.wizardForm.get('selectedRepo')?.setValue(mockGithubProjects[0]);
			fixture.detectChanges();
			tick(); // Allow async operations like finalize to complete

			expect(vibeService.getScmBranches).toHaveBeenCalledWith('github', mockGithubProjects[0].id);
			expect(component.loadingBranches).toBe(false); // Should be false after fetch
			expect(component.branchesSubject.value).toEqual(mockBranches);
			expect(component.branchError).toBeNull();
		}));

		it('should set targetBranch to defaultBranch if available after fetching', fakeAsync(() => {
			component.wizardForm.get('selectedRepo')?.setValue(mockGithubProjects[0]); // default is 'main'
			fixture.detectChanges();
			tick();

			expect(component.wizardForm.get('targetBranch')?.value).toBe('main');
		}));

		it('should handle error during branch fetching', fakeAsync(() => {
			mockVibeService.getScmBranches.mockReset().mockReturnValue(throwError(() => new Error('Branch fetch failed')));
			component.wizardForm.get('selectedRepo')?.setValue(mockGithubProjects[0]);
			fixture.detectChanges();
			tick();

			expect(vibeService.getScmBranches).toHaveBeenCalledTimes(1);
			expect(component.loadingBranches).toBe(false);
			expect(component.branchesSubject.value).toEqual([]);
			expect(component.branchError).toBe('Failed to load branches for the selected repository.');
		}));

		it('should not fetch branches when a local repo is selected', () => {
			component.wizardForm.get('selectedSource')?.setValue('local');
			fixture.detectChanges();
			component.wizardForm.get('selectedRepo')?.setValue(mockLocalRepos[0]);
			fixture.detectChanges();

			expect(vibeService.getScmBranches).not.toHaveBeenCalled();
			expect(component.loadingBranches).toBe(false);
			expect(component.branchesSubject.value).toEqual([]); // Should remain empty for local by default
			expect(component.branchError).toBeNull();
		});
	});

	describe('Working Branch Logic (updateWorkingBranchValidators)', () => {
		beforeEach(() => {
			fixture.detectChanges(); // Initial setup
		});

		it('should disable and clear other branch fields when action is "target"', () => {
			component.wizardForm.patchValue({
				existingWorkingBranch: 'some-branch',
				newWorkingBranchName: 'new-branch-name',
			});
			component.wizardForm.get('workingBranchAction')?.setValue('target');
			fixture.detectChanges();

			expect(component.wizardForm.get('existingWorkingBranch')?.disabled).toBe(true);
			expect(component.wizardForm.get('newWorkingBranchName')?.disabled).toBe(true);
			expect(component.wizardForm.get('existingWorkingBranch')?.value).toBeNull();
			expect(component.wizardForm.get('newWorkingBranchName')?.value).toBeNull();
			expect(component.wizardForm.get('existingWorkingBranch')?.valid).toBe(true); // Valid when disabled
			expect(component.wizardForm.get('newWorkingBranchName')?.valid).toBe(true); // Valid when disabled
		});

		it('should enable/require existing branch and disable new branch when action is "existing"', () => {
			component.wizardForm.patchValue({ newWorkingBranchName: 'new-branch-name' });
			component.wizardForm.get('workingBranchAction')?.setValue('existing');
			fixture.detectChanges();

			const existingControl = component.wizardForm.get('existingWorkingBranch');
			const newControl = component.wizardForm.get('newWorkingBranchName');

			expect(existingControl?.enabled).toBe(true);
			expect(existingControl?.hasValidator(Validators.required)).toBe(true);
			expect(newControl?.disabled).toBe(true);
			expect(newControl?.value).toBeNull();
			expect(newControl?.valid).toBe(true); // Valid when disabled
		});

		it('should enable/require new branch and disable existing branch when action is "new"', () => {
			component.wizardForm.patchValue({ existingWorkingBranch: 'some-branch' });
			component.wizardForm.get('workingBranchAction')?.setValue('new');
			fixture.detectChanges();

			const existingControl = component.wizardForm.get('existingWorkingBranch');
			const newControl = component.wizardForm.get('newWorkingBranchName');

			expect(newControl?.enabled).toBe(true);
			expect(newControl?.hasValidator(Validators.required)).toBe(true);
			expect(existingControl?.disabled).toBe(true);
			expect(existingControl?.value).toBeNull();
			expect(existingControl?.valid).toBe(true); // Valid when disabled
		});

		it('should add async validator for new branch name only for SCM sources', () => {
			// SCM Source
			component.wizardForm.get('selectedSource')?.setValue('github');
			component.wizardForm.get('workingBranchAction')?.setValue('new');
			fixture.detectChanges();
			expect(component.wizardForm.get('newWorkingBranchName')?.asyncValidator).not.toBeNull();

			// Local Source
			component.wizardForm.get('selectedSource')?.setValue('local');
			component.wizardForm.get('workingBranchAction')?.setValue('new');
			fixture.detectChanges();
			expect(component.wizardForm.get('newWorkingBranchName')?.asyncValidator).toBeNull();
		});

		it('should disable target and existing branch controls for SCM when repo not selected or branches loading', fakeAsync(() => {
			component.wizardForm.get('selectedSource')?.setValue('github');
			component.wizardForm.get('workingBranchAction')?.setValue('existing'); // Need existing enabled
			fixture.detectChanges();

			// 1. No repo selected
			component.wizardForm.get('selectedRepo')?.setValue(null);
			fixture.detectChanges();
			expect(component.wizardForm.get('targetBranch')?.disabled).toBe(true);
			expect(component.wizardForm.get('existingWorkingBranch')?.disabled).toBe(true);

			// 2. Repo selected, branches loading
			mockVibeService.getScmBranches.mockReturnValue(new BehaviorSubject<string[]>([])); // Simulate loading
			component.loadingBranches = true; // Manually set loading state for test clarity
			component.wizardForm.get('selectedRepo')?.setValue(mockGithubProjects[0]);
			fixture.detectChanges(); // This triggers onRepoSelectionChange -> updateValidators
			expect(component.wizardForm.get('targetBranch')?.disabled).toBe(true);
			expect(component.wizardForm.get('existingWorkingBranch')?.disabled).toBe(true);

			// 3. Branches finished loading
			component.loadingBranches = false;
			component.branchesSubject.next(mockBranches); // Simulate branches loaded
			component.updateWorkingBranchValidators(); // Manually trigger update after loading
			fixture.detectChanges();
			expect(component.wizardForm.get('targetBranch')?.enabled).toBe(true);
			expect(component.wizardForm.get('existingWorkingBranch')?.enabled).toBe(true); // Enabled because action is 'existing'
		}));

		it('should enable target and existing branch controls for local source regardless of repo selection', () => {
			component.wizardForm.get('selectedSource')?.setValue('local');
			component.wizardForm.get('workingBranchAction')?.setValue('existing'); // Need existing enabled
			fixture.detectChanges();

			// 1. No repo selected
			component.wizardForm.get('selectedRepo')?.setValue(null);
			fixture.detectChanges();
			expect(component.wizardForm.get('targetBranch')?.enabled).toBe(true);
			expect(component.wizardForm.get('existingWorkingBranch')?.enabled).toBe(true); // Enabled for local + 'existing' action

			// 2. Repo selected
			component.wizardForm.get('selectedRepo')?.setValue(mockLocalRepos[0]);
			fixture.detectChanges();
			expect(component.wizardForm.get('targetBranch')?.enabled).toBe(true);
			expect(component.wizardForm.get('existingWorkingBranch')?.enabled).toBe(true);
		});
	});

	describe('Submission (onSubmit)', () => {
		let routerSpy: jest.SpyInstance;

		beforeEach(() => {
			fixture.detectChanges(); // Initial setup
			routerSpy = jest.spyOn(router, 'navigate');
			mockVibeService.createVibeSession.mockReturnValue(of(mockCreatedSession)); // Default success mock
		});

		it('should not submit if form is invalid', () => {
			component.wizardForm.get('title')?.setValue(''); // Make form invalid
			fixture.detectChanges();
			component.onSubmit();

			expect(component.isSubmitting).toBe(false);
			expect(vibeService.createVibeSession).not.toHaveBeenCalled();
			expect(routerSpy).not.toHaveBeenCalled();
		});

		it('should not submit if already submitting', () => {
			component.isSubmitting = true;
			fixture.detectChanges();
			component.onSubmit(); // Try to submit while already submitting

			// Form might be valid, but submission should be blocked
			expect(vibeService.createVibeSession).not.toHaveBeenCalled();
			expect(routerSpy).not.toHaveBeenCalled();
		});

		it('should call createVibeSession with correct payload for local source (new branch)', () => {
			component.wizardForm.setValue({
				title: 'Local Test',
				instructions: 'Local Instructions',
				selectedSource: 'local',
				selectedRepo: '/local/path/to/repo',
				targetBranch: 'main',
				workingBranchAction: 'new',
				existingWorkingBranch: null,
				newWorkingBranchName: 'feature/local-branch',
				useSharedRepos: false, // Disabled for local
			});
			fixture.detectChanges();
			component.onSubmit();

			expect(vibeService.createVibeSession).toHaveBeenCalledWith({
				title: 'Local Test',
				instructions: 'Local Instructions',
				repositorySource: 'local',
				repositoryId: '/local/path/to/repo',
				repositoryName: 'repo', // Derived name
				targetBranch: 'main',
				workingBranch: 'feature/local-branch',
				createWorkingBranch: true,
				useSharedRepos: false,
			});
			expect(component.isSubmitting).toBe(false); // Reset after success
			expect(routerSpy).toHaveBeenCalledWith(['/vibe', 'initialise', mockCreatedSession.id]);
		});

		it('should call createVibeSession with correct payload for github source (existing branch)', () => {
			component.wizardForm.setValue({
				title: 'GitHub Test',
				instructions: 'GitHub Instructions',
				selectedSource: 'github',
				selectedRepo: mockGithubProjects[0], // The GitProject object
				targetBranch: 'main',
				workingBranchAction: 'existing',
				existingWorkingBranch: 'develop',
				newWorkingBranchName: null,
				useSharedRepos: true,
			});
			fixture.detectChanges();
			component.onSubmit();

			expect(vibeService.createVibeSession).toHaveBeenCalledWith({
				title: 'GitHub Test',
				instructions: 'GitHub Instructions',
				repositorySource: 'github',
				repositoryId: mockGithubProjects[0].id.toString(), // Project ID as string
				repositoryName: mockGithubProjects[0].name, // Project name
				targetBranch: 'main',
				workingBranch: 'develop',
				createWorkingBranch: false,
				useSharedRepos: true,
			});
			expect(component.isSubmitting).toBe(false);
			expect(routerSpy).toHaveBeenCalledWith(['/vibe', 'initialise', mockCreatedSession.id]);
		});

		it('should call createVibeSession with correct payload for gitlab source (target branch)', () => {
			component.wizardForm.setValue({
				title: 'GitLab Test',
				instructions: 'GitLab Instructions',
				selectedSource: 'gitlab',
				selectedRepo: mockGitlabProjects[0], // The GitProject object
				targetBranch: 'master',
				workingBranchAction: 'target',
				existingWorkingBranch: null,
				newWorkingBranchName: null,
				useSharedRepos: false,
			});
			fixture.detectChanges();
			component.onSubmit();

			expect(vibeService.createVibeSession).toHaveBeenCalledWith({
				title: 'GitLab Test',
				instructions: 'GitLab Instructions',
				repositorySource: 'gitlab',
				repositoryId: mockGitlabProjects[0].id.toString(), // Project ID as string
				repositoryName: mockGitlabProjects[0].name, // Project name
				targetBranch: 'master',
				workingBranch: 'master', // Same as target
				createWorkingBranch: false,
				useSharedRepos: false,
			});
			expect(component.isSubmitting).toBe(false);
			expect(routerSpy).toHaveBeenCalledWith(['/vibe', 'initialise', mockCreatedSession.id]);
		});

		it('should display snackbar message on submission error', () => {
			// Arrange
			const errorResponse = { message: 'Failed to create' };
			mockVibeService.createVibeSession.mockReset().mockReturnValue(throwError(() => errorResponse));
			const snackBarSpy = jest.spyOn(snackBar, 'open');

			// Set valid form data
			component.wizardForm.setValue({
				title: 'Error Test',
				instructions: 'Error Instructions',
				selectedSource: 'local',
				selectedRepo: '/local/path',
				targetBranch: 'main',
				workingBranchAction: 'new',
				existingWorkingBranch: null,
				newWorkingBranchName: 'error-branch',
				useSharedRepos: false,
			});
			fixture.detectChanges();

			// Act
			component.onSubmit();

			// Assert
			expect(vibeService.createVibeSession).toHaveBeenCalled();
			expect(snackBarSpy).toHaveBeenCalledWith(
				expect.stringContaining(`Error creating Vibe session: ${errorResponse.message}`),
				'Close',
				expect.objectContaining({
					duration: 5000,
					verticalPosition: 'top',
				}),
			);
			expect(component.isSubmitting).toBe(false); // Reset after error
			expect(routerSpy).not.toHaveBeenCalled();
		});
	});

	describe('Preset Functionality', () => {
		beforeEach(() => {
			// Setup mocks for preset tests
			mockVibeService.listVibePresets.mockReturnValue(of(mockPresets));
			mockWorkflowsService.getRepositories.mockReturnValue(of(mockLocalRepos)); // Needed for applyPreset local
			mockVibeService.getScmProjects.mockReturnValue(of([...mockGithubProjects, ...mockGitlabProjects])); // Needed for applyPreset SCM
			mockVibeService.getScmBranches.mockReturnValue(of(mockBranches)); // Needed for applyPreset -> onRepoSelectionChange
			fixture.detectChanges(); // Trigger ngOnInit -> loadPresets
		});

		it('should load presets on init', (done) => {
			expect(vibeService.listVibePresets).toHaveBeenCalledTimes(1);
			component.presets$.subscribe((presets) => {
				expect(presets).toEqual(mockPresets);
				expect(component.loadingPresets).toBe(false);
				expect(component.presetError).toBeNull();
				done();
			});
		});

		it('should handle errors during preset loading', () => {
			// Arrange
			mockVibeService.listVibePresets.mockReset().mockReturnValue(throwError(() => new Error('Preset load failed')));

			// Act: Re-run ngOnInit essentially by calling loadPresets again
			component.loadPresets();
			fixture.detectChanges();

			// Assert
			expect(component.loadingPresets).toBe(false);
			expect(component.presetError).toBe('Failed to load presets.');
			component.presets$.subscribe((presets) => {
				expect(presets).toEqual([]); // Should be empty on error
			});
		});

		it('should apply a selected local preset to the form', fakeAsync(() => {
			const localPreset = mockPresets[0];
			component.applyPreset(localPreset);
			tick(); // Allow setTimeout in applyPreset to run
			fixture.detectChanges(); // Update view after patching

			expect(component.wizardForm.get('selectedSource')?.value).toBe(localPreset.config.repositorySource);
			expect(component.wizardForm.get('selectedRepo')?.value).toBe(localPreset.config.repositoryId);
			expect(component.wizardForm.get('targetBranch')?.value).toBe(localPreset.config.targetBranch);
			expect(component.wizardForm.get('workingBranchAction')?.value).toBe('new'); // Derived from createWorkingBranch: true
			expect(component.wizardForm.get('newWorkingBranchName')?.value).toBe(localPreset.config.workingBranch);
			expect(component.wizardForm.get('existingWorkingBranch')?.value).toBeNull();
			expect(component.wizardForm.get('useSharedRepos')?.value).toBe(localPreset.config.useSharedRepos);
			// Check if branch loading was triggered (it shouldn't for local)
			expect(vibeService.getScmBranches).not.toHaveBeenCalled();
		}));

		it('should apply a selected SCM preset and find the project object', fakeAsync(() => {
			const scmPreset = mockPresets[1]; // GitHub preset, ID '1'
			component.applyPreset(scmPreset);
			tick(); // Allow setTimeout in applyPreset to run
			fixture.detectChanges(); // Update view after patching

			expect(component.wizardForm.get('selectedSource')?.value).toBe(scmPreset.config.repositorySource);
			// Crucially, check if the *object* was found and set
			expect(component.wizardForm.get('selectedRepo')?.value).toBe(mockGithubProjects[0]); // Found the object with id: 1
			expect(component.wizardForm.get('targetBranch')?.value).toBe(scmPreset.config.targetBranch);
			expect(component.wizardForm.get('workingBranchAction')?.value).toBe('existing'); // Derived from createWorkingBranch: false and working != target
			expect(component.wizardForm.get('existingWorkingBranch')?.value).toBe(scmPreset.config.workingBranch);
			expect(component.wizardForm.get('newWorkingBranchName')?.value).toBeNull();
			expect(component.wizardForm.get('useSharedRepos')?.value).toBe(scmPreset.config.useSharedRepos);
			// Check if branch loading was triggered for the SCM repo
			expect(vibeService.getScmBranches).toHaveBeenCalledWith('github', mockGithubProjects[0].id);
		}));

		it('should show warning if SCM project object is not found when applying preset', fakeAsync(() => {
			const snackBarSpy = jest.spyOn(snackBar, 'open');
			const invalidPreset: VibePreset = {
				...mockPresets[1],
				config: { ...mockPresets[1].config, repositoryId: '999' }, // Non-existent ID
			};

			component.applyPreset(invalidPreset);
			tick();
			fixture.detectChanges();

			expect(snackBarSpy).toHaveBeenCalledWith(expect.stringContaining('Preset Warning: Could not find the saved github repository'), 'Close', expect.any(Object));
			expect(component.wizardForm.get('selectedRepo')?.value).toBeNull(); // Repo field should be reset
		}));

		it('should save a new preset with valid form data', () => {
			// Arrange
			const presetName = 'My New Preset';
			jest.spyOn(window, 'prompt').mockReturnValue(presetName);
			mockVibeService.saveVibePreset.mockReturnValue(of({ ...mockPresets[0], name: presetName })); // Mock successful save
			const snackBarSpy = jest.spyOn(snackBar, 'open');
			const loadPresetsSpy = jest.spyOn(component, 'loadPresets');

			// Set valid form data (using local example)
			component.wizardForm.setValue({
				title: 'Preset Save Test',
				instructions: 'Preset Instructions',
				selectedSource: 'local',
				selectedRepo: '/local/path/save',
				targetBranch: 'main',
				workingBranchAction: 'new',
				existingWorkingBranch: null,
				newWorkingBranchName: 'feature/save-branch',
				useSharedRepos: false,
			});
			fixture.detectChanges();

			// Act
			component.savePreset();

			// Assert
			expect(window.prompt).toHaveBeenCalledWith('Enter a name for this preset:');
			expect(vibeService.saveVibePreset).toHaveBeenCalledWith(
				presetName,
				expect.objectContaining<VibePresetConfig>({
					repositorySource: 'local',
					repositoryId: '/local/path/save',
					repositoryName: 'save',
					targetBranch: 'main',
					workingBranch: 'feature/save-branch',
					createWorkingBranch: true,
					useSharedRepos: false,
				}),
			);
			expect(snackBarSpy).toHaveBeenCalledWith(expect.stringContaining(`Preset "${presetName}" saved successfully!`), 'Close', expect.any(Object));
			expect(loadPresetsSpy).toHaveBeenCalledTimes(1); // Called once in ngOnInit, once after save
			expect(component.isSubmitting).toBe(false);
		});

		it('should not save preset if form is invalid', () => {
			jest.spyOn(window, 'prompt').mockReturnValue('Invalid Preset');
			const snackBarSpy = jest.spyOn(snackBar, 'open');
			component.wizardForm.get('title')?.setValue(''); // Make form invalid
			fixture.detectChanges();

			component.savePreset();

			expect(vibeService.saveVibePreset).not.toHaveBeenCalled();
			expect(snackBarSpy).toHaveBeenCalledWith('Cannot save preset: Form is invalid.', 'Close', expect.any(Object));
		});

		it('should not save preset if user cancels prompt', () => {
			jest.spyOn(window, 'prompt').mockReturnValue(null); // Simulate cancel
			component.wizardForm.setValue({ /* valid data */ }); // Assume form is valid
			fixture.detectChanges();

			component.savePreset();

			expect(vibeService.saveVibePreset).not.toHaveBeenCalled();
		});

		it('should handle errors during preset saving', () => {
			// Arrange
			const errorResponse = { message: 'Save failed' };
			mockVibeService.saveVibePreset.mockReset().mockReturnValue(throwError(() => errorResponse));
			jest.spyOn(window, 'prompt').mockReturnValue('Error Save Preset');
			const snackBarSpy = jest.spyOn(snackBar, 'open');
			const loadPresetsSpy = jest.spyOn(component, 'loadPresets');

			// Set valid form data
			component.wizardForm.setValue({
				title: 'Preset Error Test',
				instructions: 'Error Instructions',
				selectedSource: 'local',
				selectedRepo: '/local/path/error',
				targetBranch: 'main',
				workingBranchAction: 'new',
				existingWorkingBranch: null,
				newWorkingBranchName: 'error-branch',
				useSharedRepos: false,
			});
			fixture.detectChanges();

			// Act
			component.savePreset();

			// Assert
			expect(vibeService.saveVibePreset).toHaveBeenCalled();
			expect(snackBarSpy).toHaveBeenCalledWith(expect.stringContaining(`Error saving preset: ${errorResponse.message}`), 'Close', expect.any(Object));
			expect(loadPresetsSpy).toHaveBeenCalledTimes(0); // Not called on error
			expect(component.isSubmitting).toBe(false);
		});
	});
});
