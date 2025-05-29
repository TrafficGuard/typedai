import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CodeReviewServiceClient } from './code-review.service';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';
import { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import {
    CodeReviewConfigCreate,
    CodeReviewConfigUpdate,
    MessageResponse,
    BulkDeleteRequest,
    CodeReviewConfigListResponse
} from '#shared/codeReview/codeReview.schema';

describe('CodeReviewServiceClient', () => {
  let service: CodeReviewServiceClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CodeReviewServiceClient]
    });
    service = TestBed.inject(CodeReviewServiceClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify(); // Verify that no unmatched requests are outstanding.
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getCodeReviewConfigs', () => {
    it('should call GET on the correct API endpoint and return data', () => {
      const mockResponse: CodeReviewConfigListResponse = [
        { id: '1', title: 'Test Config 1', enabled: true, description: 'Desc 1', fileExtensions: { include: ['.ts'] }, requires: { text: ['TODO'] }, tags: ['test'], projectPaths: ['/proj1'], examples: [] }
      ];
      const expectedPath = CODE_REVIEW_API.list.pathTemplate;

      service.getCodeReviewConfigs().subscribe(data => {
        expect(data).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle API errors', () => {
      const expectedPath = CODE_REVIEW_API.list.pathTemplate;
      service.getCodeReviewConfigs().subscribe({
        next: () => fail('should have failed with an error'),
        error: (error) => {
          expect(error).toBeTruthy();
        }
      });

      const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
      req.flush('Simulated API Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getCodeReviewConfig', () => {
    it('should call GET on the correct API endpoint with id and return data', () => {
      const testId = '123';
      const mockResponse: CodeReviewConfig = { id: testId, title: 'Test Config', enabled: true, description: 'Desc', fileExtensions: { include: ['.ts'] }, requires: { text: ['TODO'] }, tags: ['test'], projectPaths: ['/proj1'], examples: [] };
      const expectedPath = CODE_REVIEW_API.getById.buildPath({ id: testId });

      service.getCodeReviewConfig(testId).subscribe(data => {
        expect(data).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle API errors', () => {
        const testId = '123';
        const expectedPath = CODE_REVIEW_API.getById.buildPath({ id: testId });
        service.getCodeReviewConfig(testId).subscribe({
            next: () => fail('should have failed with an error'),
            error: (error) => {
                expect(error).toBeTruthy();
            }
        });
        const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
        req.flush('Simulated API Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('createCodeReviewConfig', () => {
    it('should call POST on the correct API endpoint with body and return data', () => {
      const mockPayload: CodeReviewConfigCreate = { title: 'New Config', enabled: false, description: 'New Desc', fileExtensions: { include: ['.js'] }, requires: { text: [] }, tags: [], projectPaths: [], examples: [] };
      const mockResponse: MessageResponse = { message: 'Config created' };
      const expectedPath = CODE_REVIEW_API.create.pathTemplate;

      service.createCodeReviewConfig(mockPayload).subscribe(data => {
        expect(data).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockPayload);
      req.flush(mockResponse, { status: 201, statusText: 'Created' });
    });

     it('should handle API errors', () => {
        const mockPayload: CodeReviewConfigCreate = { title: 'New Config', enabled: false, description: 'New Desc', fileExtensions: { include: ['.js'] }, requires: { text: [] }, tags: [], projectPaths: [], examples: [] };
        const expectedPath = CODE_REVIEW_API.create.pathTemplate;
        service.createCodeReviewConfig(mockPayload).subscribe({
            next: () => fail('should have failed with an error'),
            error: (error) => {
                expect(error).toBeTruthy();
            }
        });
        const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
        req.flush('Simulated API Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('updateCodeReviewConfig', () => {
    it('should call PUT on the correct API endpoint with id and body, and return data', () => {
      const testId = '123';
      const mockPayload: CodeReviewConfigUpdate = { title: 'Updated Config', enabled: true, description: 'Updated Desc', fileExtensions: { include: ['.ts', '.js'] }, requires: { text: ['FIXME'] }, tags: ['updated'], projectPaths: ['/proj2'], examples: [] };
      const mockResponse: MessageResponse = { message: 'Config updated' };
      const expectedPath = CODE_REVIEW_API.update.buildPath({ id: testId });

      service.updateCodeReviewConfig(testId, mockPayload).subscribe(data => {
        expect(data).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(mockPayload);
      req.flush(mockResponse);
    });

    it('should handle API errors', () => {
        const testId = '123';
        const mockPayload: CodeReviewConfigUpdate = { title: 'Updated Config', enabled: true, description: 'Updated Desc', fileExtensions: { include: ['.ts', '.js'] }, requires: { text: ['FIXME'] }, tags: ['updated'], projectPaths: ['/proj2'], examples: [] };
        const expectedPath = CODE_REVIEW_API.update.buildPath({ id: testId });
        service.updateCodeReviewConfig(testId, mockPayload).subscribe({
            next: () => fail('should have failed with an error'),
            error: (error) => {
                expect(error).toBeTruthy();
            }
        });
        const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
        req.flush('Simulated API Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('deleteCodeReviewConfig', () => {
    it('should call DELETE on the correct API endpoint with id and return data', () => {
      const testId = '123';
      const mockResponse: MessageResponse = { message: 'Config deleted' };
      const expectedPath = CODE_REVIEW_API.delete.buildPath({ id: testId });

      service.deleteCodeReviewConfig(testId).subscribe(data => {
        expect(data).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
      expect(req.request.method).toBe('DELETE');
      req.flush(mockResponse);
    });

    it('should handle API errors', () => {
        const testId = '123';
        const expectedPath = CODE_REVIEW_API.delete.buildPath({ id: testId });
        service.deleteCodeReviewConfig(testId).subscribe({
            next: () => fail('should have failed with an error'),
            error: (error) => {
                expect(error).toBeTruthy();
            }
        });
        const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
        req.flush('Simulated API Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('deleteCodeReviewConfigs', () => {
    it('should call POST on the bulk-delete API endpoint with ids and return data', () => {
      const idsToDelete = ['1', '2', '3'];
      const mockPayload: BulkDeleteRequest = { ids: idsToDelete };
      const mockResponse: MessageResponse = { message: 'Configs deleted' };
      const expectedPath = CODE_REVIEW_API.bulkDelete.pathTemplate;

      service.deleteCodeReviewConfigs(idsToDelete).subscribe(data => {
        expect(data).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockPayload);
      req.flush(mockResponse);
    });

    it('should handle API errors for bulk delete', () => {
        const idsToDelete = ['1', '2', '3'];
        const expectedPath = CODE_REVIEW_API.bulkDelete.pathTemplate;
        service.deleteCodeReviewConfigs(idsToDelete).subscribe({
            next: () => fail('should have failed with an error'),
            error: (error) => {
                expect(error).toBeTruthy();
            }
        });
        const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
        req.flush('Simulated API Error', { status: 500, statusText: 'Server Error' });
    });
  });
});
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { CodeReviewServiceClient } from './code-review.service';
import * as apiRoute from '../../core/api-route';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';
import { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import { of, throwError, Subject } from 'rxjs';
import { ApiListState } from '../../core/api-state.types';
import { HttpClient } from '@angular/common/http';

describe('CodeReviewServiceClient', () => {
  let service: CodeReviewServiceClient;
  let callApiRouteSpy: jasmine.Spy;
  let httpClient: HttpClient;

  const mockConfigs: CodeReviewConfig[] = [
    { id: '1', title: 'Config 1', enabled: true, description: 'Desc 1', fileExtensions: { include: ['.ts'] }, requires: { text: ['TODO'] }, tags: ['tag1'], projectPaths: ['/proj1'], examples: [] },
    { id: '2', title: 'Config 2', enabled: false, description: 'Desc 2', fileExtensions: { include: ['.js'] }, requires: { text: [] }, tags: ['tag2'], projectPaths: ['/proj2'], examples: [] },
  ];

  const mockMessageResponse = { message: 'Success' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CodeReviewServiceClient]
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
      service.getCodeReviewConfig('1').subscribe(config => {
        expect(config).toEqual(singleConfig);
        expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.getById, { pathParams: { id: '1' } });
        done();
      });
    });
  });

  describe('createCodeReviewConfig', () => {
    it('should call callApiRoute and reload configs on success', (done) => {
      const newConfigCreate = { title: 'New', enabled: true, description: '', fileExtensions: { include: [] }, requires: { text: [] }, tags: [], projectPaths: [], examples: [] };
      callApiRouteSpy.and.callFake((http: HttpClient, routeDef: any) => {
        if (routeDef === CODE_REVIEW_API.create) {
          return of(mockMessageResponse); // For create call
        }
        if (routeDef === CODE_REVIEW_API.list) {
          return of(mockConfigs); // For subsequent loadConfigs call
        }
        return of({});
      });

      service.createCodeReviewConfig(newConfigCreate).subscribe(response => {
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


      service.updateCodeReviewConfig('1', updatedConfigPayload as any /* partial update for test */).subscribe(response => {
        expect(response).toEqual(mockMessageResponse);
        expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.update, { pathParams: { id: '1' }, body: updatedConfigPayload as any });

        const state = service.configsState();
        if (state.status === 'success') {
          const updatedItem = state.data.find(c => c.id === '1');
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

      service.deleteCodeReviewConfig('1').subscribe(response => {
        expect(response).toEqual(mockMessageResponse);
        expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.delete, { pathParams: { id: '1' } });
        const state = service.configsState();
        if (state.status === 'success') {
          expect(state.data.find(c => c.id === '1')).toBeUndefined();
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

      service.deleteCodeReviewConfigs(idsToDelete).subscribe(response => {
        expect(response).toEqual(mockMessageResponse);
        expect(callApiRouteSpy).toHaveBeenCalledWith(httpClient, CODE_REVIEW_API.bulkDelete, { body: { ids: idsToDelete } });
         const state = service.configsState();
        if (state.status === 'success') {
          expect(state.data.find(c => c.id === '1')).toBeUndefined();
          expect(state.data.length).toBe(mockConfigs.length - 1);
        } else {
          fail('State should be success');
        }
        done();
      });
    });
  });
});
