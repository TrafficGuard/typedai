import { signal, WritableSignal } from '@angular/core';

export type ApiState<T> =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'success'; data: T }
	| { status: 'error'; error: Error; code?: number };

export type ApiListState<T> = ApiState<T[]>;

export type ApiEntityState<T> = ApiState<T> | { status: 'not_found' } | { status: 'forbidden' };

export function createApiListState<T>(): WritableSignal<ApiListState<T>> {
	return signal<ApiListState<T>>({ status: 'idle' });
}

export function createApiEntityState<T>(): WritableSignal<ApiEntityState<T>> {
	return signal<ApiEntityState<T>>({ status: 'idle' });
}
