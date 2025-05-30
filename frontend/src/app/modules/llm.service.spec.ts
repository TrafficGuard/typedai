import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { LLM, LlmService } from './llm.service';

describe('LlmService', () => {
	let service: LlmService;
	let httpMock: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			imports: [HttpClientTestingModule],
			providers: [LlmService],
		});
		service = TestBed.inject(LlmService);
		httpMock = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		httpMock.verify();
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});

	describe('ApiListState pattern', () => {
		it('should have initial idle state', () => {
			const state = service.llmsState();
			expect(state.status).toBe('idle');
		});

		it('should set loading state when loadLlms is called', () => {
			service.loadLlms();

			const state = service.llmsState();
			expect(state.status).toBe('loading');
		});

		it('should set success state with mock data', fakeAsync(() => {
			const mockLlms: LLM[] = [
				{ id: 'llm1', name: 'LLM 1', isConfigured: true },
				{ id: 'llm2', name: 'LLM 2', isConfigured: false },
			];

			service.loadLlms();

			const req = httpMock.expectOne('/api/llms/list');
			expect(req.request.method).toBe('GET');
			req.flush({ data: mockLlms });
			tick();

			const state = service.llmsState();
			expect(state.status).toBe('success');
			if (state.status === 'success') {
				expect(state.data).toEqual(mockLlms);
			}
		}));

		it('should set error state with mock error', fakeAsync(() => {
			service.loadLlms();

			const req = httpMock.expectOne('/api/llms/list');
			req.error(new ErrorEvent('Network error'), { status: 500 });
			tick();

			const state = service.llmsState();
			expect(state.status).toBe('error');
			if (state.status === 'error') {
				expect(state.error.message).toBe('Failed to load LLMs');
				expect(state.code).toBe(500);
			}
		}));
	});

	describe('service methods', () => {
		it('should not make duplicate requests when already loading', fakeAsync(() => {
			const mockLlms: LLM[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

			service.loadLlms();
			service.loadLlms(); // Second call should be ignored

			// Only one request should be made
			const req = httpMock.expectOne('/api/llms/list');
			req.flush({ data: mockLlms });
			tick();

			const state = service.llmsState();
			expect(state.status).toBe('success');
			if (state.status === 'success') {
				expect(state.data).toEqual(mockLlms);
			}
		}));

		it('should not make duplicate requests when already successful', () => {
			const mockLlms: LLM[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

			// First call
			service.loadLlms();
			const req1 = httpMock.expectOne('/api/llms/list');
			req1.flush({ data: mockLlms });

			// Second call should be ignored since state is already success
			service.loadLlms();
			httpMock.expectNone('/api/llms/list');
		});

		it('should reload data when refreshLlms is called', fakeAsync(() => {
			const mockLlms: LLM[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

			// Initial load
			service.loadLlms();
			const req1 = httpMock.expectOne('/api/llms/list');
			req1.flush({ data: mockLlms });
			tick();

			// Refresh should make a new request
			service.refreshLlms();
			const req2 = httpMock.expectOne('/api/llms/list');
			req2.flush({ data: mockLlms });
			tick();

			const state = service.llmsState();
			expect(state.status).toBe('success');
		}));

		it('should refresh data when clearCache is called', fakeAsync(() => {
			const mockLlms: LLM[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

			// Initial load
			service.loadLlms();
			const req1 = httpMock.expectOne('/api/llms/list');
			req1.flush({ data: mockLlms });
			tick();

			// Clear cache should make a new request
			service.clearCache();
			const req2 = httpMock.expectOne('/api/llms/list');
			req2.flush({ data: mockLlms });
			tick();

			const state = service.llmsState();
			expect(state.status).toBe('success');
		}));
	});

	describe('API integration', () => {
		it('should call API with correct parameters', () => {
			service.loadLlms();

			const req = httpMock.expectOne('/api/llms/list');
			expect(req.request.method).toBe('GET');
			expect(req.request.url).toBe('/api/llms/list');
		});

		it('should handle API response correctly', fakeAsync(() => {
			const mockLlms: LLM[] = [
				{ id: 'llm1', name: 'LLM 1', isConfigured: true },
				{ id: 'llm2', name: 'LLM 2', isConfigured: false },
			];

			service.loadLlms();

			const req = httpMock.expectOne('/api/llms/list');
			req.flush({ data: mockLlms });
			tick();

			const state = service.llmsState();
			expect(state.status).toBe('success');
			if (state.status === 'success') {
				expect(state.data).toEqual(mockLlms);
			}
		}));
	});

	describe('error handling', () => {
		it('should handle network errors', fakeAsync(() => {
			service.loadLlms();

			const req = httpMock.expectOne('/api/llms/list');
			req.error(new ErrorEvent('Network error'), { status: 0 });
			tick();

			const state = service.llmsState();
			expect(state.status).toBe('error');
			if (state.status === 'error') {
				expect(state.error.message).toBe('Failed to load LLMs');
				expect(state.code).toBe(0);
			}
		}));

		it('should handle server errors', fakeAsync(() => {
			service.loadLlms();

			const req = httpMock.expectOne('/api/llms/list');
			req.error(new ErrorEvent('Server error'), { status: 500 });
			tick();

			const state = service.llmsState();
			expect(state.status).toBe('error');
			if (state.status === 'error') {
				expect(state.error.message).toBe('Failed to load LLMs');
				expect(state.code).toBe(500);
			}
		}));

		it('should handle malformed responses', fakeAsync(() => {
			service.loadLlms();

			const req = httpMock.expectOne('/api/llms/list');
			req.error(new ErrorEvent('Parse error'), { status: 400 });
			tick();

			const state = service.llmsState();
			expect(state.status).toBe('error');
			if (state.status === 'error') {
				expect(state.error.message).toBe('Failed to load LLMs');
				expect(state.code).toBe(400);
			}
		}));
	});
});
