import { HttpClientTestingModule } from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { CodeTask } from '#shared/codeTask/codeTask.model';
import { ApiEntityState } from '../../core/api-state.types';
import { createApiEntityState } from '../../core/api-state.types';
import { CodeTaskComponent } from './codeTask.component';
import { CodeTaskPo } from './codeTask.component.po';
import { CodeTaskServiceClient } from './codeTask.service';

// Mocks
class MockCodeTaskServiceClient {
	private readonly _mockCurrentCodeTaskState: WritableSignal<ApiEntityState<CodeTask>> = createApiEntityState<CodeTask>();
	readonly currentCodeTaskState = this._mockCurrentCodeTaskState.asReadonly();

	loadCodeTask = jasmine.createSpy('loadCodeTask').and.callFake((taskId: string) => {
		// Default behavior: simulate loading then success with a generic task
		// Tests can override this spy per specific scenario.
		this._mockCurrentCodeTaskState.set({ status: 'loading' });
		// Simulate async operation
		Promise.resolve().then(() => {
			if (taskId === 'error-id') {
				this._mockCurrentCodeTaskState.set({ status: 'error', error: new Error('Mock fetch error') });
			} else if (taskId === 'not-found-id') {
				this._mockCurrentCodeTaskState.set({ status: 'not_found' });
			} else {
				this._mockCurrentCodeTaskState.set({
					status: 'success',
					data: { id: taskId, title: `Loaded Task ${taskId}` } as CodeTask,
				});
			}
		});
	});

	resetFileSelection = jasmine.createSpy('resetFileSelection').and.returnValue(of(undefined));

	// Helper to directly set the state for testing various UI states
	setMockState(state: ApiEntityState<CodeTask>): void {
		this._mockCurrentCodeTaskState.set(state);
	}
}

class MockMatSnackBar {
	open = jasmine.createSpy('open');
}

describe('CodeTaskComponent', () => {
	let component: CodeTaskComponent;
	let fixture: ComponentFixture<CodeTaskComponent>;
	let codeTaskService: MockCodeTaskServiceClient;
	let snackBar: MockMatSnackBar;
	let router: Router;
	let po: CodeTaskPo;

	const testCodeTaskId = 'test-codeTask-id';
	const mockCodeTask: CodeTask = {
		id: testCodeTaskId,
		title: 'Test CodeTask',
		instructions: 'Test Instructions',
		status: 'file_selection_review', // This is CodeTaskStatusInternalStatus
		userId: 'test-user',
		repositorySource: 'local',
		repositoryId: '/path/to/repo',
		targetBranch: 'main',
		workingBranch: 'feat/test',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		fileSelection: [],
		design: null,
		selectedVariations: null,
		codeDiff: null,
		codeTaskError: null,
	};

	let paramMapSubject: Subject<ParamMap>;

	beforeEach(async () => {
		paramMapSubject = new Subject<ParamMap>();
		await TestBed.configureTestingModule({
			imports: [CodeTaskComponent, NoopAnimationsModule, HttpClientTestingModule],
			providers: [
				{ provide: CodeTaskServiceClient, useClass: MockCodeTaskServiceClient },
				{ provide: MatSnackBar, useClass: MockMatSnackBar },
				{ provide: ActivatedRoute, useValue: { paramMap: paramMapSubject.asObservable(), snapshot: { params: {} } } }, // Added snapshot
				{ provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(CodeTaskComponent);
		component = fixture.componentInstance;
		codeTaskService = TestBed.inject(CodeTaskServiceClient) as unknown as MockCodeTaskServiceClient;
		snackBar = TestBed.inject(MatSnackBar) as unknown as MockMatSnackBar;
		router = TestBed.inject(Router);
		po = await CodeTaskPo.create(fixture); // Create Page Object
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	describe('Initialization (ngOnInit)', () => {
		it('should display loading spinner initially when codeTaskState is idle', async () => {
			codeTaskService.setMockState({ status: 'idle' });
			paramMapSubject.next(convertToParamMap({ id: testCodeTaskId }));
			await po.detectAndWait();
			expect(await po.isLoading()).toBeTrue();
		});

		it('should call loadCodeTask with ID from route params', async () => {
			paramMapSubject.next(convertToParamMap({ id: testCodeTaskId }));
			await po.detectAndWait(); // Allow ngOnInit to process paramMap
			expect(codeTaskService.loadCodeTask).toHaveBeenCalledWith(testCodeTaskId);
		});

		it('should display task title and status when successfully loaded', async () => {
			codeTaskService.setMockState({ status: 'success', data: mockCodeTask });
			paramMapSubject.next(convertToParamMap({ id: testCodeTaskId })); // Trigger ngOnInit
			await po.detectAndWait();

			expect(await po.isLoading()).toBeFalse();
			expect(po.getTaskTitle()).toBe(mockCodeTask.title);
			// The status text includes "Status: " and the internal status
			expect(po.getStatusText()).toContain(mockCodeTask.status);
			expect(po.getStatusText()).toContain(mockCodeTask.workingBranch);
		});

		it('should log an error and not call loadCodeTask if codeTaskId is missing from route', async () => {
			const consoleErrorSpy = spyOn(console, 'error');
			codeTaskService.loadCodeTask.calls.reset();

			paramMapSubject.next(convertToParamMap({})); // No 'id' parameter
			await po.detectAndWait();

			expect(consoleErrorSpy).toHaveBeenCalledWith('Code Task ID not found in route parameters');
			expect(codeTaskService.loadCodeTask).not.toHaveBeenCalled();
		});

		it('should display error message if loadCodeTask results in an error state', async () => {
			const errorMessage = 'Failed to fetch task details.';
			codeTaskService.setMockState({ status: 'error', error: new Error(errorMessage) });
			paramMapSubject.next(convertToParamMap({ id: 'some-id' }));
			await po.detectAndWait();

			expect(await po.isLoading()).toBeFalse();
			expect(po.isErrorMessageVisible()).toBeTrue();
			expect(po.getErrorMessageText()).toContain(errorMessage);
		});

		it('should display "not found" message if loadCodeTask results in not_found state', async () => {
			codeTaskService.setMockState({ status: 'not_found' });
			paramMapSubject.next(convertToParamMap({ id: 'not-found-id' }));
			await po.detectAndWait();

			expect(await po.isLoading()).toBeFalse();
			expect(po.isNotFoundMessageVisible()).toBeTrue();
		});
	});

	describe('Reset File Selection', () => {
		beforeEach(async () => {
			// Ensure a valid task is loaded for these tests
			codeTaskService.setMockState({ status: 'success', data: mockCodeTask });
			paramMapSubject.next(convertToParamMap({ id: testCodeTaskId }));
			await po.detectAndWait(); // Ensure component is initialized with data

			// Reset spies for each test in this block
			snackBar.open.calls.reset();
			codeTaskService.resetFileSelection.calls.reset();
			component.isProcessingAction = false; // Ensure flag is reset
			await po.detectAndWait(); // Reflect isProcessingAction change if it affects UI
		});

		it('should show snackbar and not call service if currentCodeTask is null (e.g., state is idle)', async () => {
			codeTaskService.setMockState({ status: 'idle' }); // Makes currentCodeTask() return null
			await po.detectAndWait();

			await po.clickResetSelectionButton();
			await po.detectAndWait();

			expect(snackBar.open).toHaveBeenCalledWith('Error: CodeTask data not available.', 'Close', { duration: 3000 });
			expect(codeTaskService.resetFileSelection).not.toHaveBeenCalled();
		});

		it('should show snackbar and not call service if an action is already in progress', async () => {
			component.isProcessingAction = true; // Directly set internal state for this specific test condition
			await po.detectAndWait(); // Reflect change, e.g., button might be disabled

			expect(await po.isResetSelectionButtonDisabled()).toBeTrue(); // Assuming button gets disabled

			await po.clickResetSelectionButton(); // Attempt to click (might be no-op if truly disabled)
			await po.detectAndWait();

			expect(snackBar.open).toHaveBeenCalledWith('Please wait, another action is in progress.', 'Close', { duration: 3000 });
			expect(codeTaskService.resetFileSelection).not.toHaveBeenCalled();
		});

		it('should call resetFileSelection, disable button during processing, and show success snackbar on success', async () => {
			codeTaskService.resetFileSelection.and.returnValue(of(undefined));

			await po.clickResetSelectionButton();
			// Check if button becomes disabled immediately (or after a microtask)
			expect(await po.isResetSelectionButtonDisabled()).toBeTrue(); // isProcessingAction is set
			await po.detectAndWait(); // Allow observable to complete

			expect(codeTaskService.resetFileSelection).toHaveBeenCalledWith(testCodeTaskId);
			expect(await po.isResetSelectionButtonDisabled()).toBeFalse(); // isProcessingAction is reset
			expect(snackBar.open).toHaveBeenCalledWith('File selection reset successfully. CodeTask will refresh.', 'Close', {
				duration: 3500,
			});
		});

		it('should handle error from resetFileSelection, re-enable button, and show error snackbar', async () => {
			const errorResponse = { message: 'Reset failed' };
			codeTaskService.resetFileSelection.and.returnValue(throwError(() => errorResponse));

			await po.clickResetSelectionButton();
			expect(await po.isResetSelectionButtonDisabled()).toBeTrue();
			await po.detectAndWait(); // Allow observable to error

			expect(codeTaskService.resetFileSelection).toHaveBeenCalledWith(testCodeTaskId);
			expect(await po.isResetSelectionButtonDisabled()).toBeFalse();
			expect(snackBar.open).toHaveBeenCalledWith(`Error resetting file selection: ${errorResponse.message}`, 'Close', {
				duration: 5000,
			});
		});
	});

	describe('ngOnDestroy', () => {
		it('should complete the destroy$ subject', () => {
			const destroyNextSpy = spyOn(component.destroy$, 'next').and.callThrough();
			const destroyCompleteSpy = spyOn(component.destroy$, 'complete').and.callThrough();

			fixture.destroy(); // This calls ngOnDestroy

			expect(destroyNextSpy).toHaveBeenCalledTimes(1);
			expect(destroyCompleteSpy).toHaveBeenCalledTimes(1);
			expect(destroyNextSpy).toHaveBeenCalledBefore(destroyCompleteSpy);
		});
	});
});
