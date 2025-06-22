import { HttpClient } from '@angular/common/http';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';
import { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import * as apiRoute from '../../core/api-route';
import { ApiListState } from '../../core/api-state.types';
import { CodeReviewServiceClient } from './code-review.service';

describe('CodeReviewServiceClient', () => {
	let service: CodeReviewServiceClient;
	let callApiRouteSpy: jasmine.Spy;
	let httpClient: HttpClient;

	const mockConfigs: CodeReviewConfig[] = [
		{
			id: '1',
			title: 'Config 1',
			enabled: true,
			description: 'Desc 1',
			fileExtensions: { include: ['.ts'] },
			requires: { text: ['TODO'] },
			tags: ['tag1'],
			projectPaths: ['/proj1'],
			examples: [],
		},
		{
			id: '2',
			title: 'Config 2',
			enabled: false,
			description: 'Desc 2',
			fileExtensions: { include: ['.js'] },
			requires: { text: [] },
			tags: ['tag2'],
			projectPaths: ['/proj2'],
			examples: [],
		},
	];

	const mockMessageResponse = { message: 'Success' };

	beforeEach(() => {
		TestBed.configureTestingModule({
			imports: [HttpClientTestingModule],
			providers: [CodeReviewServiceClient],
		});

		// callApiRoute is spied on here, before the service is injected.
		callApiRouteSpy = spyOn(apiRoute, 'callApiRoute');
		service = TestBed.inject(CodeReviewServiceClient);
		httpClient = TestBed.inject(HttpClient); // Get instance of HttpClient for spy verification
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});

	describe('getCodeReviewConfigs (and loadConfigs)', () => {
		it('should make an API call and update state to success on initial load', () => {
			callApiRouteSpy.and.returnValue(of(mockConfigs));
			expect(service.configsState().status).toBe('idle');

			service.getCodeReviewConfigs();

			expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.list);
			expect(service.configsState().status).toBe('success');
			expect((service.configsState() as Extract<ApiListState<CodeReviewConfig>, { status: 'success' }>).data).toEqual(mockConfigs);
			expect(callApiRouteSpy).toHaveBeenCalledTimes(1);
		});

		it('should not make an API call if configs are already loaded successfully (cache hit)', () => {
			// Initial load
			callApiRouteSpy.and.returnValue(of(mockConfigs));
			service.getCodeReviewConfigs();
			expect(callApiRouteSpy).toHaveBeenCalledTimes(1);
			expect(service.configsState().status).toBe('success');

			// Subsequent call
			service.getCodeReviewConfigs();
			expect(callApiRouteSpy).toHaveBeenCalledTimes(1); // Should still be 1
			expect(service.configsState().status).toBe('success');
		});

		it('should handle API errors during loadConfigs and set state to error', () => {
			const apiError = new Error('API Error');
			(apiError as any).status = 500;
			callApiRouteSpy.and.returnValue(throwError(() => apiError));

			service.getCodeReviewConfigs();

			expect(callApiRouteSpy).toHaveBeenCalledTimes(1);
			expect(service.configsState().status).toBe('error');
			const errorState = service.configsState() as Extract<ApiListState<CodeReviewConfig>, { status: 'error' }>;
			expect(errorState.error.message).toBe('API Error');
			expect(errorState.code).toBe(500);
		});

		it('should use "Failed to load configs" for non-Error instances from API', () => {
			const apiError = { message: 'Non-Error object', status: 503 }; // Not an instanceof Error
			callApiRouteSpy.and.returnValue(throwError(() => apiError));

			service.getCodeReviewConfigs();

			expect(callApiRouteSpy).toHaveBeenCalledTimes(1);
			expect(service.configsState().status).toBe('error');
			const errorState = service.configsState() as Extract<ApiListState<CodeReviewConfig>, { status: 'error' }>;
			expect(errorState.error.message).toBe('Failed to load configs');
			expect(errorState.code).toBe(503);
		});

		it('should not make a new API call if a load is already in progress', () => {
			const apiResponse$ = new Subject<CodeReviewConfig[]>();
			callApiRouteSpy.and.returnValue(apiResponse$.asObservable());

			// First call
			service.getCodeReviewConfigs();
			expect(callApiRouteSpy).toHaveBeenCalledTimes(1);
			expect(service.configsState().status).toBe('loading');

			// Second call while first is loading
			service.getCodeReviewConfigs();
			expect(callApiRouteSpy).toHaveBeenCalledTimes(1); // Still 1
			expect(service.configsState().status).toBe('loading');

			// Resolve first call
			apiResponse$.next(mockConfigs);
			apiResponse$.complete();

			expect(service.configsState().status).toBe('success');
			expect((service.configsState() as Extract<ApiListState<CodeReviewConfig>, { status: 'success' }>).data).toEqual(mockConfigs);
		});
	});

	describe('refreshConfigs', () => {
		it('should reset state to idle, make an API call, and update state on refresh, bypassing cache', () => {
			// Initial load to populate cache
			callApiRouteSpy.and.returnValue(of(mockConfigs));
			service.getCodeReviewConfigs();
			expect(callApiRouteSpy).toHaveBeenCalledTimes(1);
			expect(service.configsState().status).toBe('success');

			// Refresh
			const newMockConfigs: CodeReviewConfig[] = [{ ...mockConfigs[0], title: 'Updated Config 1' }];
			callApiRouteSpy.and.returnValue(of(newMockConfigs)); // Spy will return new data for the next call

			service.refreshConfigs();

			// Check that state was briefly idle then loading (hard to test idle without more control, focus on outcome)
			// The call to loadConfigs inside refreshConfigs will set it to loading then success.
			expect(callApiRouteSpy).toHaveBeenCalledTimes(2);
			expect(service.configsState().status).toBe('success');
			expect((service.configsState() as Extract<ApiListState<CodeReviewConfig>, { status: 'success' }>).data).toEqual(newMockConfigs);
		});
	});

	// Basic tests for other methods to ensure spy is correctly configured for them if they also use callApiRoute

	describe('getCodeReviewConfig (single)', () => {
		it('should call callApiRoute for getCodeReviewConfig', (done) => {
			const singleConfig = mockConfigs[0];
			callApiRouteSpy.and.returnValue(of(singleConfig));
			service.getCodeReviewConfig('1').subscribe((config) => {
				expect(config).toEqual(singleConfig);
				expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.getById, { pathParams: { id: '1' } });
				done();
			});
		});
	});

	describe('createCodeReviewConfig', () => {
		it('should call callApiRoute and reload configs on success', (done) => {
			const newConfigCreate = {
				title: 'New',
				enabled: true,
				description: '',
				fileExtensions: { include: [] },
				requires: { text: [] },
				tags: [],
				projectPaths: [],
				examples: [],
			};
			callApiRouteSpy.and.callFake((http: HttpClient, routeDef: any) => {
				if (routeDef === CODE_REVIEW_API.create) {
					return of(mockMessageResponse); // For create call
				}
				if (routeDef === CODE_REVIEW_API.list) {
					return of(mockConfigs); // For subsequent loadConfigs call
				}
				return of({});
			});

			service.createCodeReviewConfig(newConfigCreate).subscribe((response) => {
				expect(response).toEqual(mockMessageResponse);
				expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.create, { body: newConfigCreate });
				// loadConfigs is called, which in turn calls callApiRoute for list
				expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.list);
				expect(service.configsState().status).toBe('success'); // Due to loadConfigs
				done();
			});
		});
	});

	describe('updateCodeReviewConfig', () => {
		it('should call callApiRoute and update configs in state on success', (done) => {
			// Preload state
			callApiRouteSpy.and.returnValue(of([...mockConfigs]));
			service.getCodeReviewConfigs(); // Initial load

			const updatedConfigPayload = { title: 'Updated Title' };
			const expectedUpdatedConfig = { ...mockConfigs[0], ...updatedConfigPayload };
			// Spy for update, then for list (if it were reloaded, but it updates inline)
			callApiRouteSpy.and.callFake((http: HttpClient, routeDef: any, args: any) => {
				if (routeDef === CODE_REVIEW_API.update && args.pathParams.id === '1') {
					return of(mockMessageResponse); // API returns message
				}
				return of({}); // Should not be called for list
			});

			service.updateCodeReviewConfig('1', updatedConfigPayload as any /* partial update for test */).subscribe((response) => {
				expect(response).toEqual(mockMessageResponse);
				expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.update, { pathParams: { id: '1' }, body: updatedConfigPayload as any });

				const state = service.configsState();
				if (state.status === 'success') {
					const updatedItem = state.data.find((c) => c.id === '1');
					expect(updatedItem?.title).toBe('Updated Title');
				} else {
					fail('State should be success');
				}
				done();
			});
		});
	});

	describe('deleteCodeReviewConfig', () => {
		it('should call callApiRoute and remove config from state on success', (done) => {
			// Preload state
			callApiRouteSpy.and.returnValue(of([...mockConfigs]));
			service.getCodeReviewConfigs(); // Initial load

			callApiRouteSpy.and.returnValue(of(mockMessageResponse)); // For delete call

			service.deleteCodeReviewConfig('1').subscribe((response) => {
				expect(response).toEqual(mockMessageResponse);
				expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.delete, { pathParams: { id: '1' } });
				const state = service.configsState();
				if (state.status === 'success') {
					expect(state.data.find((c) => c.id === '1')).toBeUndefined();
					expect(state.data.length).toBe(mockConfigs.length - 1);
				} else {
					fail('State should be success');
				}
				done();
			});
		});
	});

	describe('deleteCodeReviewConfigs (bulk)', () => {
		it('should call callApiRoute and remove configs from state on success', (done) => {
			// Preload state
			callApiRouteSpy.and.returnValue(of([...mockConfigs]));
			service.getCodeReviewConfigs(); // Initial load

			callApiRouteSpy.and.returnValue(of(mockMessageResponse)); // For bulkDelete call
			const idsToDelete = ['1'];

			service.deleteCodeReviewConfigs(idsToDelete).subscribe((response) => {
				expect(response).toEqual(mockMessageResponse);
				expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.bulkDelete, { body: { ids: idsToDelete } });
				const state = service.configsState();
				if (state.status === 'success') {
					expect(state.data.find((c) => c.id === '1')).toBeUndefined();
					expect(state.data.length).toBe(mockConfigs.length - 1);
				} else {
					fail('State should be success');
				}
				done();
			});
		});
	});
});
