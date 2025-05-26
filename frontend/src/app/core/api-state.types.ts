import { signal, WritableSignal } from '@angular/core';


type ApiState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error; code?: number };

/**
 * Represent a state/result for loading an entity from an API endpoint
 */
export type ApiListState<T> = ApiState<T[]>;

/**
 * Represent a state/result for loading an entity from an API endpoint
 */
export type ApiEntityState<T> =
  | ApiState<T>
  | { status: 'not_found' }
  | { status: 'forbidden' };

export function createApiListState<T>(): WritableSignal<ApiListState<T>> {
  return signal<ApiListState<T>>({ status: 'idle' });
}

export function createApiEntityState<T>(): WritableSignal<ApiEntityState<T>> {
  return signal<ApiEntityState<T>>({ status: 'idle' });
}
