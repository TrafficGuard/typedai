import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, catchError, map, tap, throwError } from 'rxjs';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { CodeTask, CodeTaskPreset, CodeTaskPresetConfig } from '#shared/codeTask/codeTask.model';
import { FileSystemNode } from '#shared/files/fileSystemService';
import { SelectedFile } from '#shared/files/files.model';
import { GitProject } from '#shared/scm/git.model';
import { callApiRoute } from '../../core/api-route';
import { createApiEntityState, createApiListState } from '../../core/api-state.types';

// Define the shape of the data needed for creation, matching the backend API body
export interface CreateCodeTaskPayload {
	title: string;
	instructions: string;
	repositorySource: 'local' | 'github' | 'gitlab';
	repositoryFullPath: string;
	repositoryName?: string | null;
	targetBranch: string;
	workingBranch: string;
	createWorkingBranch: boolean;
	useSharedRepos: boolean;
}

// Define the shape of the data needed for updating, matching the backend API body
export interface UpdateCodeTaskPayload {
	filesToAdd?: string[];
	filesToRemove?: string[];
	fileSelection?: SelectedFile[]; // Added to support updating the entire file selection
	// Add other updatable fields as needed, e.g.:
	// instructions?: string;
	// designDecision?: 'accepted' | 'rejected';
	// variations?: number;
}

@Injectable({
	providedIn: 'root',
})
export class CodeTaskServiceClient {
	private http = inject(HttpClient);

	private readonly _currentCodeTaskState = createApiEntityState<CodeTask>();
	readonly currentCodeTaskState = this._currentCodeTaskState.asReadonly();
	private readonly _codeTasksState = createApiListState<CodeTask>();
	readonly codeTasksState = this._codeTasksState.asReadonly();

	/**
	 * Observable for the currently active CodeTask.
	 */
	get currentCodeTask$(): Observable<CodeTask | null> {
		const currentCodeTaskSignal = computed(() => {
			const state = this._currentCodeTaskState();
			return state.status === 'success' ? state.data : null;
		});
		return toObservable(currentCodeTaskSignal);
	}

	/**
	 * Getter for codeTasks (if using BehaviorSubject) - Keep commented out unless needed
	 */
	get codeTasks$(): Observable<CodeTask[] | null> {
		const codeTasksSignal = computed(() => {
			const state = this._codeTasksState();
			return state.status === 'success' ? state.data : null;
		});
		return toObservable(codeTasksSignal);
	}

	/**
	 * Backward compatibility method for components expecting Observable return
	 */
	listCodeTasks(): Observable<CodeTask[]> {
		this.loadCodeTasks();
		return this.codeTasks$.pipe(map((codeTasks) => codeTasks || []));
	}

	/**
	 * Backward compatibility method for components expecting Observable return
	 */
	getCodeTask(id: string): Observable<CodeTask | null> {
		this.loadCodeTask(id);
		return this.currentCodeTask$;
	}

	/**
	 * Backward compatibility method for components expecting Observable return
	 */
	refreshCodeTasks(): Observable<CodeTask[]> {
		this.loadCodeTasks();
		return this.codeTasks$.pipe(map((codeTasks) => codeTasks || []));
	}

	// HTTP calls must match the backend API endpoints defined in src/routes/codeTask/codeTaskRoutes.ts

	/**
	 * Loads the list of Code tasks from the backend.
	 */
	loadCodeTasks(): void {
		if (this._codeTasksState().status === 'loading') return;

		this._codeTasksState.set({ status: 'loading' });

		callApiRoute(this.http, CODE_TASK_API.list)
			.pipe(
				tap((codeTasks: CodeTask[]) => {
					this._codeTasksState.set({ status: 'success', data: codeTasks });
				}),
				catchError((error) => {
					this._codeTasksState.set({
						status: 'error',
						error: error instanceof Error ? error : new Error('Failed to load codeTasks'),
						code: error?.status,
					});
					return EMPTY;
				}),
			)
			.subscribe();
	}

	getCodeTasks(): void {
		this.loadCodeTasks();
	}

	/**
	 * Creates a new Code task via the backend API.
	 * @param data The data required to create the codeTask.
	 * @returns An Observable emitting the newly created CodeTask.
	 */
	createCodeTask(data: CreateCodeTaskPayload): Observable<CodeTask> {
		return callApiRoute(this.http, CODE_TASK_API.create, { body: data }).pipe(
			tap((newCodeTask: CodeTask) => {
				const currentState = this._codeTasksState();
				if (currentState.status === 'success') {
					this._codeTasksState.set({
						status: 'success',
						data: [newCodeTask, ...currentState.data],
					});
				}
			}),
		);
	}

	/**
	 * Fetches the list of available SCM projects (GitHub, GitLab) from the backend.
	 */
	getScmProjects(): Observable<GitProject[]> {
		return this.http.get<GitProject[]>('/api/scm/projects');
	}

	// TODO move this API route to /api/scm/repositories
	getRepositories(): Observable<string[]> {
		return this.http.get<string[]>('/api/workflows/repositories');
	}

	/**
	 * Fetches the list of branches for a given SCM project.
	 * @param providerType The type of the SCM provider (e.g., 'local', 'github', 'gitlab').
	 * @param projectId The ID or path of the SCM project.
	 */
	getScmBranches(providerType: string, projectId: string | number): Observable<string[]> {
		// Use HttpParams to correctly encode query parameters
		const params = new HttpParams()
			.set('providerType', providerType)
			// Ensure projectId is sent as a string, as expected by the backend schema
			.set('projectId', String(projectId));

		return this.http.get<string[]>('/api/scm/branches', { params });
	}

	/**
	 * Loads a specific Code task by its ID from the backend.
	 * @param id The ID of the Code task.
	 */
	loadCodeTask(id: string): void {
		if (this._currentCodeTaskState().status === 'loading') return;

		this._currentCodeTaskState.set({ status: 'loading' });

		callApiRoute(this.http, CODE_TASK_API.getById, { pathParams: { codeTaskId: id } })
			.pipe(
				tap((codeTask) => {
					this._currentCodeTaskState.set({ status: 'success', data: codeTask });
					// Update codeTask in list if it exists
					const currentState = this._codeTasksState();
					if (currentState.status === 'success') {
						const updatedCodeTasks = currentState.data.map((s) => (s.id === id ? codeTask : s));
						this._codeTasksState.set({ status: 'success', data: updatedCodeTasks });
					}
				}),
				catchError((error) => {
					if (error?.status === 404) {
						this._currentCodeTaskState.set({ status: 'not_found' });
					} else if (error?.status === 403) {
						this._currentCodeTaskState.set({ status: 'forbidden' });
					} else {
						this._currentCodeTaskState.set({
							status: 'error',
							error: error instanceof Error ? error : new Error('Failed to load codeTask'),
							code: error?.status,
						});
					}
					return EMPTY;
				}),
			)
			.subscribe();
	}

	clearCurrentCodeTask(): void {
		this._currentCodeTaskState.set({ status: 'idle' });
	}

	/**
	 * Fetches the file system tree for a given Code task ID.
	 * @param codeTaskId The ID of the Code task.
	 * @returns An Observable emitting an array of FileSystemNode objects.
	 */
	getFileSystemTree(codeTaskId: string): Observable<FileSystemNode> {
		return callApiRoute(this.http, CODE_TASK_API.getFileSystemTree, { pathParams: { codeTaskId } });
	}

	/**
	 * Updates a specific Code task by its ID using a PATCH request.
	 * @param id The ID of the Code task to update.
	 * @param payload The data to update.
	 */
	updateCodeTask(id: string, payload: UpdateCodeTaskPayload): Observable<void> {
		return callApiRoute(this.http, CODE_TASK_API.update, { pathParams: { codeTaskId: id }, body: payload }).pipe(
			tap(() => {
				// Reload the codeTask to get updated data
				this.loadCodeTask(id);
				// Refresh codeTasks list
				this.loadCodeTasks();
			}),
		);
	}

	/**
	 * Deletes a specific Code task by its ID.
	 * @param id The ID of the Code task to delete.
	 */
	deleteCodeTask(id: string): Observable<void> {
		return callApiRoute(this.http, CODE_TASK_API.delete, { pathParams: { codeTaskId: id } }).pipe(
			tap(() => {
				const currentState = this._codeTasksState();
				if (currentState.status === 'success') {
					const filteredCodeTasks = currentState.data.filter((s) => s.id !== id);
					this._codeTasksState.set({ status: 'success', data: filteredCodeTasks });
				}
				const currentCodeTaskState = this._currentCodeTaskState();
				if (currentCodeTaskState.status === 'success' && currentCodeTaskState.data.id === id) {
					this._currentCodeTaskState.set({ status: 'idle' });
				}
			}),
		);
	}

	/**
	 * Sends a prompt to the backend to refine the design for a specific Code task.
	 * @param codeTaskId The ID of the Code task.
	 * @param prompt The user's instructions for refinement.
	 * @returns An Observable that completes when the request is sent (backend returns void/202).
	 */
	updateDesignWithPrompt(codeTaskId: string, prompt: string): Observable<void> {
		return this.http.post<void>(`/api/codeTask/${codeTaskId}/update-design-prompt`, { prompt });
	}

	/**
	 * Triggers the backend to start implementing the approved design for a specific Code task.
	 * @param codeTaskId The ID of the Code task.
	 * @returns An Observable that completes when the request is sent (backend returns void/202).
	 */
	executeDesign(codeTaskId: string): Observable<void> {
		return this.http.post<void>(`/api/codeTask/${codeTaskId}/execute-design`, {});
	}

	/**
	 * Approves the current file selection and triggers design generation.
	 * @param codeTaskId The ID of the Code task.
	 * @param variations The number of design variations to generate.
	 * @returns An Observable that completes when the request is accepted (backend returns 202).
	 */
	approveFileSelection(codeTaskId: string, variations?: number | null): Observable<void> {
		const body: { variations?: number } = {};

		if (variations !== null && variations !== undefined && typeof variations === 'number' && variations >= 1 && variations <= 3) {
			body.variations = variations;
		}

		return this.http.post<void>(`/api/codeTask/${codeTaskId}/generate-design`, body).pipe(
			tap(() => {}), // Placeholder tap if needed, or remove tap entirely if no other side effects
			catchError((error) => {
				// Consider adding console.error or other basic logging if needed
				return throwError(() => error);
			}),
		);
	}

	/**
	 * Sends a prompt to the backend to update the file selection for a specific Code task.
	 * @param codeTaskId The ID of the Code task.
	 * @param prompt The user's instructions for updating the selection.
	 * @returns An Observable that completes when the request is accepted (backend returns 202).
	 */
	updateFileSelection(codeTaskId: string, prompt: string): Observable<void> {
		return this.http.post<void>(`/api/codeTask/${codeTaskId}/update-selection`, { prompt }).pipe(
			tap(() => {}), // Placeholder tap if needed, or remove tap entirely if no other side effects
			catchError((error) => {
				// Consider adding console.error or other basic logging if needed
				return throwError(() => error);
			}),
		);
	}

	/**
	 * Requests the backend to reset the file selection for a specific Code task
	 * to its original AI-selected state for the current review cycle.
	 * @param codeTaskId The ID of the Code task.
	 * @returns An Observable that completes when the request is accepted (backend returns 202 or similar).
	 */
	resetFileSelection(codeTaskId: string): Observable<void> {
		return this.http.post<void>(`/api/codeTask/${codeTaskId}/reset-selection`, {}).pipe(
			tap(() => {
				// Optionally, trigger a refresh of the current codeTask if needed,
				// though typically the component calling this would handle UI updates/refreshes.
				console.log(`CodeTaskService: Reset file selection request sent for codeTask ${codeTaskId}`);
			}),
			catchError((error) => {
				console.error(`CodeTaskService: Error resetting file selection for codeTask ${codeTaskId}`, error);
				return throwError(() => error);
			}),
		);
	}

	// --- Preset Management ---

	/**
	 * Fetches the list of Code task presets from the backend.
	 */
	listCodeTaskPresets(): Observable<CodeTaskPreset[]> {
		return this.http.get<CodeTaskPreset[]>('/api/codeTask/presets');
	}

	/**
	 * Saves a new Code task preset to the backend.
	 * @param name The name for the new preset.
	 * @param config The configuration object for the preset.
	 * @returns An Observable emitting the newly created CodeTaskPreset.
	 */
	saveCodeTaskPreset(name: string, config: CodeTaskPresetConfig): Observable<CodeTaskPreset> {
		return this.http.post<CodeTaskPreset>('/api/codeTask/presets', { name, config });
	}

	/**
	 * Deletes a specific Code task preset by its ID.
	 * @param presetId The ID of the preset to delete.
	 */
	deleteCodeTaskPreset(presetId: string): Observable<void> {
		return this.http.delete<void>(`/api/codeTask/presets/${presetId}`);
	}
}
