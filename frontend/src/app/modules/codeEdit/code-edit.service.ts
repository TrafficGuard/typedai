import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, tap, EMPTY } from 'rxjs';

import { CODE_EDIT_API } from '#shared/codeEdit/codeEdit.api';
import { callApiRoute } from '#core/api-route';
import { FileSystemNode } from '#shared/files/fileSystemService';
import { createApiEntityState } from '#core/api-state.types';

@Injectable({ providedIn: 'root' })
export class CodeEditService {
	private readonly httpClient = inject(HttpClient);

	// Private writable signal to manage the state internally.
	private readonly _treeState = createApiEntityState<FileSystemNode>();
	// Public readonly signal to expose the state to the rest of the application.
	readonly treeState = this._treeState.asReadonly();

	/**
	 * Fetches the file system tree from the backend.
	 * This method is non-blocking and updates the treeState signal.
	 */
	getFileSystemTree(): void {
		// Prevent new requests if one is already in progress.
		if (this.treeState().status === 'loading') {
			return;
		}

		// Set the state to 'loading' before making the API call.
		this._treeState.set({ status: 'loading' });

		callApiRoute(this.httpClient, CODE_EDIT_API.getFileSystemTree)
			.pipe(
				// On success, update the state with the fetched data.
				tap((response) => {
					this._treeState.set({ status: 'success', data: response });
				}),
				// On error, update the state with the error information.
				catchError((error: any) => {
					if (error?.status === 404) {
						this._treeState.set({ status: 'not_found' });
					} else {
						this._treeState.set({
							status: 'error',
							error: error instanceof Error ? error : new Error('Failed to load file system tree'),
							code: error?.status,
						});
					}
					// Return EMPTY to complete the observable chain gracefully.
					return EMPTY;
				}),
			)
			// Subscribe to execute the entire observable chain.
			.subscribe();
	}
}
