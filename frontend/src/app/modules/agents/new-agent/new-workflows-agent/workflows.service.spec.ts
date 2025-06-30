import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ApiListState } from '../../../../core/api-state.types'; // Assuming this path is correct based on usage
import { WorkflowsService } from './workflows.service';
import { effect } from '@angular/core';

describe('WorkflowsService', () => {
	let service: WorkflowsService;
	let httpMock: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			imports: [HttpClientTestingModule],
			providers: [WorkflowsService],
		});
		service = TestBed.inject(WorkflowsService);
		httpMock = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		httpMock.verify(); // Verify that no unmatched requests are outstanding.
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});

	describe('loadRepositories', () => {
		it('should fetch repositories and update repositoriesState on success', (done) => {
			const mockRepositories = ['repo1', 'repo2'];
			let callCount = 0;

			// Effect to listen to state changes
			effect(() => {
				const state = service.repositoriesState();
				callCount++;
				if (callCount === 1) {
					// Initial state by createApiListState
					expect(state.status).toBe('idle');
				} else if (callCount === 2) {
					// Loading state after service.loadRepositories()
					expect(state.status).toBe('loading');
				} else if (callCount === 3) {
					// Success state after flush
					expect(state.status).toBe('success');
					if (state.status === 'success') {
						expect(state.data).toEqual(mockRepositories);
					}
					done(); // Complete the async test
				}
			});

			service.loadRepositories();

			const req = httpMock.expectOne('/api/workflows/repositories');
			expect(req.request.method).toBe('GET');
			req.flush(mockRepositories);
		});

		it('should update repositoriesState to error on HTTP error', (done) => {
			let callCount = 0;
			effect(() => {
				const state = service.repositoriesState();
				callCount++;
				if (callCount === 1) {
					expect(state.status).toBe('idle');
				} else if (callCount === 2) {
					expect(state.status).toBe('loading');
				} else if (callCount === 3) {
					// Error state
					expect(state.status).toBe('error');
					if (state.status === 'error') {
						expect(state.error).toBeTruthy();
						expect(state.code).toBe(500);
					}
					done();
				}
			});

			service.loadRepositories();
			const req = httpMock.expectOne('/api/workflows/repositories');
			req.flush({ message: 'Error loading' }, { status: 500, statusText: 'Server Error' });
		});

		it('should not make a new request if one is already loading', () => {
			service.loadRepositories(); // repositoriesState becomes 'loading'
			const req1 = httpMock.expectOne('/api/workflows/repositories');
			expect(req1.request.method).toBe('GET');

			// Attempt second call while first is loading
			service.loadRepositories(); // Should return due to loading check
			httpMock.expectNone('/api/workflows/repositories'); // No new request should be made after the first one

			req1.flush([]); // Complete the first request
		});
	});

	describe('runCodeEditorImplementRequirements', () => {
		it('should POST to /api/workflows/edit and return data on success', (done) => {
			const mockPayload = { workingDirectory: '/test', requirements: 'implement feature' };
			const mockResponse = { result: 'success' };

			service.runCodeEditorImplementRequirements(mockPayload.workingDirectory, mockPayload.requirements).subscribe((response) => {
				expect(response).toEqual(mockResponse);
				done();
			});

			const req = httpMock.expectOne('/api/workflows/edit');
			expect(req.request.method).toBe('POST');
			expect(req.request.body).toEqual(mockPayload);
			req.flush(mockResponse);
		});

		it('should handle error for runCodeEditorImplementRequirements', (done) => {
			const mockPayload = { workingDirectory: '/test', requirements: 'implement feature' };
			service.runCodeEditorImplementRequirements(mockPayload.workingDirectory, mockPayload.requirements).subscribe({
				next: () => fail('should have failed with an error'),
				error: (err) => {
					expect(err).toBeTruthy();
					done();
				},
			});
			const req = httpMock.expectOne('/api/workflows/edit');
			req.flush({ message: 'Error' }, { status: 500, statusText: 'Server Error' });
		});
	});

	describe('runCodebaseQuery', () => {
		it('should POST to /api/workflows/query and return data on success', (done) => {
			const mockPayload = { workingDirectory: '/test', query: 'find something' };
			const mockResponse = { response: 'found it' };

			service.runCodebaseQuery(mockPayload.workingDirectory, mockPayload.query).subscribe((response) => {
				expect(response).toEqual(mockResponse);
				done();
			});

			const req = httpMock.expectOne('/api/workflows/query');
			expect(req.request.method).toBe('POST');
			expect(req.request.body).toEqual(mockPayload);
			req.flush(mockResponse);
		});

		it('should handle error for runCodebaseQuery', (done) => {
			const mockPayload = { workingDirectory: '/test', query: 'find something' };
			service.runCodebaseQuery(mockPayload.workingDirectory, mockPayload.query).subscribe({
				next: () => fail('should have failed with an error'),
				error: (err) => {
					expect(err).toBeTruthy();
					done();
				},
			});
			const req = httpMock.expectOne('/api/workflows/query');
			req.flush({ message: 'Error' }, { status: 500, statusText: 'Server Error' });
		});
	});

	describe('selectFilesToEdit', () => {
		it('should POST to /api/workflows/select-files and return data on success', (done) => {
			const mockPayload = { workingDirectory: '/test', requirements: 'select files for feature' };
			const mockResponse = { files: ['file1.ts', 'file2.html'] };

			service.selectFilesToEdit(mockPayload.workingDirectory, mockPayload.requirements).subscribe((response) => {
				expect(response).toEqual(mockResponse);
				done();
			});

			const req = httpMock.expectOne('/api/workflows/select-files');
			expect(req.request.method).toBe('POST');
			expect(req.request.body).toEqual(mockPayload);
			req.flush(mockResponse);
		});

		it('should handle error for selectFilesToEdit', (done) => {
			const mockPayload = { workingDirectory: '/test', requirements: 'select files for feature' };
			service.selectFilesToEdit(mockPayload.workingDirectory, mockPayload.requirements).subscribe({
				next: () => fail('should have failed with an error'),
				error: (err) => {
					expect(err).toBeTruthy();
					done();
				},
			});
			const req = httpMock.expectOne('/api/workflows/select-files');
			req.flush({ message: 'Error' }, { status: 500, statusText: 'Server Error' });
		});
	});
});
