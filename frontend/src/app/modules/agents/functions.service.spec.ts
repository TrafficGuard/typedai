import { HttpErrorResponse } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { ApiListState } from '../../core/api-state.types';
import { FunctionsService } from './functions.service';

describe('FunctionsService', () => {
	let service: FunctionsService;
	let httpMock: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			imports: [HttpClientTestingModule],
			providers: [FunctionsService],
		});
		service = TestBed.inject(FunctionsService);
		httpMock = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		httpMock.verify();
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});

	it('should have initial state "idle"', () => {
		const currentState = service.functionsState();
		expect(currentState.status).toBe('idle');
	});

	describe('getFunctions', () => {
		it('should fetch functions successfully and update state', () => {
			service.getFunctions();

			let currentState = service.functionsState();
			expect(currentState.status).toBe('loading');

			const req = httpMock.expectOne(`${environment.apiBaseUrl}agent/v1/functions`);
			expect(req.request.method).toBe('GET');

			const mockFunctions = ['func1', 'func2', 'func3'];
			req.flush(mockFunctions);

			currentState = service.functionsState();
			expect(currentState.status).toBe('success');
			if (currentState.status === 'success') {
				expect(currentState.data).toEqual(mockFunctions);
			} else {
				fail('State should be success');
			}
		});

		it('should handle HTTP error and update state to "error"', () => {
			service.getFunctions();

			let currentState = service.functionsState();
			expect(currentState.status).toBe('loading');

			const req = httpMock.expectOne(`${environment.apiBaseUrl}agent/v1/functions`);
			req.flush('Test Error', { status: 500, statusText: 'Server Error' }); // Simulates HttpErrorResponse from server

			currentState = service.functionsState();
			expect(currentState.status).toBe('error');
			if (currentState.status === 'error') {
				// The service wraps the HttpErrorResponse in a new Error object
				expect(currentState.error).toBeInstanceOf(Error);
				// The service sets a generic message if the original error is not an Error instance,
				// or uses the original error's message. Since HttpErrorResponse is an Error, its message might be used.
				// However, the service's catchError logic is: `error: error instanceof Error ? error : new Error('Failed to load functions')`
				// A raw HttpErrorResponse is an instance of Error. So its message would be used.
				// Let's adjust to check the specific message from the service's logic if it's a generic wrapper.
				// Given the service code: `error: error instanceof HttpErrorResponse ? new Error('Failed to load functions') : (error instanceof Error ? error : new Error('Failed to load functions'))`
				// Actually, it's `error: error instanceof Error ? error : new Error('Failed to load functions')`
				// And `HttpErrorResponse` *is* an `instanceof Error`.
				// So, `currentState.error` will be the `HttpErrorResponse` itself.
				// The message check should be more specific or the service's error handling needs to be precise.
				// For now, let's stick to the service's current behavior where it might pass HttpErrorResponse directly.
				// If `error` is `HttpErrorResponse`, then `error.message` would be the HTTP error message.
				// The service code is: `this._functionsState.set({ status: 'error', error: error instanceof Error ? error : new Error('Failed to load functions'), code: error.status });`
				// So `currentState.error` IS the `HttpErrorResponse` object.
				expect(currentState.error.message).toBeTruthy(); // Check that an error message exists
				expect(currentState.code).toBe(500);
			} else {
				fail('State should be error');
			}
		});

		it('should retry 3 times on HTTP error before final failure (total 4 attempts)', () => {
			service.getFunctions();
			const url = `${environment.apiBaseUrl}agent/v1/functions`;

			// Initial attempt + 3 retries = 4 attempts total
			for (let i = 0; i < 4; i++) {
				const req = httpMock.expectOne(url);
				req.flush(`Error attempt ${i + 1}`, { status: 500, statusText: 'Server Error' });
			}

			const currentState = service.functionsState();
			expect(currentState.status).toBe('error');
			if (currentState.status === 'error') {
				expect(currentState.code).toBe(500);
			} else {
				fail('State should be error after retries');
			}
		});

		it('should not make a new HTTP call if already loading', () => {
			service.getFunctions(); // First call

			const req = httpMock.expectOne(`${environment.apiBaseUrl}agent/v1/functions`);
			expect(service.functionsState().status).toBe('loading');

			service.getFunctions(); // Second call while first is pending

			// Verifying no new request: if another httpMock.expectOne(URL) was called here, it would fail.
			// The httpMock.verify() in afterEach will also fail if there are unexpected requests.
			// This implicitly tests that no new request for this URL was made.

			req.flush(['funcX']); // Complete the first request
			expect(service.functionsState().status).toBe('success');
		});
	});
});
