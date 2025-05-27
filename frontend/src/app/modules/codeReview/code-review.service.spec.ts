import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CodeReviewServiceClient } from './code-review.service';
import { CODE_REVIEW_API } from '#shared/api/code-review.api';
import { CodeReviewConfig } from '#shared/model/codeReview.model';
import {
    CodeReviewConfigCreate,
    CodeReviewConfigUpdate,
    MessageResponse,
    BulkDeleteRequest,
    CodeReviewConfigListResponse
} from '#shared/schemas/codeReview.schema';

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
