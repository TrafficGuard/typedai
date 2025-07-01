import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LlmService } from './llm.service';
import { LlmInfo } from '#shared/llm/llm.model';
import { LLMS_API } from '#shared/llm/llm.api';

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

			// Flush the pending request to prevent an error in afterEach
			const req = httpMock.expectOne(LLMS_API.list.pathTemplate);
			req.flush({ data: [] });
		});

		it('should set success state with mock data', () => {
			const mockLlms: LlmInfo[] = [
				{ id: 'llm1', name: 'LLM 1', isConfigured: true },
				{ id: 'llm2', name: 'LLM 2', isConfigured: false },
			];

			service.loadLlms();

			const req = httpMock.expectOne(LLMS_API.list.pathTemplate);
			expect(req.request.method).toBe('GET');
			req.flush({ data: mockLlms });

			const state = service.llmsState();
			expect(state.status).toBe('success');
			if (state.status === 'success') {
				expect(state.data).toEqual(mockLlms);
			}
		});

		it('should set error state with mock error', () => {
			service.loadLlms();

			const req = httpMock.expectOne(LLMS_API.list.pathTemplate);
			req.flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });

			const state = service.llmsState();
			expect(state.status).toBe('error');
			if (state.status === 'error') {
				expect(state.error.message).toBe('Failed to load LLMs');
				expect(state.code).toBe(500);
			}
		});
	});

	describe('service methods', () => {
		it('should not make duplicate requests when already loading', () => {
			const mockLlms: LlmInfo[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

			service.loadLlms();
			service.loadLlms(); // Second call should be ignored

			// Only one request should be made
			const reqs = httpMock.match(LLMS_API.list.pathTemplate);
			expect(reqs.length).toBe(1);

			reqs[0].flush({ data: mockLlms });

			const state = service.llmsState();
			expect(state.status).toBe('success');
			if (state.status === 'success') {
				expect(state.data).toEqual(mockLlms);
			}
		});

		it('should not make duplicate requests when already successful', () => {
			const mockLlms: LlmInfo[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

			// First call
			service.loadLlms();
			const req1 = httpMock.expectOne(LLMS_API.list.pathTemplate);
			req1.flush({ data: mockLlms });

			// Second call should be ignored since state is already success
			service.loadLlms();
			httpMock.expectNone(LLMS_API.list.pathTemplate);
			expect(service.llmsState().status).toBe('success');
		});

		it('should reload data when refreshLlms is called', () => {
			const mockLlms: LlmInfo[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

			// Initial load
			service.loadLlms();
			const req1 = httpMock.expectOne(LLMS_API.list.pathTemplate);
			req1.flush({ data: mockLlms });

			// Refresh should make a new request
			service.refreshLlms();
			const req2 = httpMock.expectOne(LLMS_API.list.pathTemplate);
			req2.flush({ data: mockLlms });

			const state = service.llmsState();
			expect(state.status).toBe('success');
		});

		it('should refresh data when clearCache is called', () => {
			const mockLlms: LlmInfo[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

			// Initial load
			service.loadLlms();
			const req1 = httpMock.expectOne(LLMS_API.list.pathTemplate);
			req1.flush({ data: mockLlms });

			// Clear cache should make a new request
			service.clearCache();
			const req2 = httpMock.expectOne(LLMS_API.list.pathTemplate);
			req2.flush({ data: mockLlms });

			const state = service.llmsState();
			expect(state.status).toBe('success');
		});
	});
});
