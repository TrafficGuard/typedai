import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { LlmService, LLM } from './llm.service';


const LLM_LIST_API_URL = `/api/llms/list`;

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

  it('should fetch LLMs from the server', () => {
    const mockLlms: LLM[] = [
      { id: 'llm1', name: 'LLM 1', isConfigured: true },
      { id: 'llm2', name: 'LLM 2', isConfigured: false },
    ];

    service.getLlms().subscribe((llms) => {
      expect(llms).toEqual(mockLlms);
    });

    const req = httpMock.expectOne(`${LLM_LIST_API_URL}`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: mockLlms });
  });

  it('should cache LLMs per user', () => {
    const mockLlms1: LLM[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

    service.getLlms().subscribe();
    httpMock.expectOne(`${LLM_LIST_API_URL}`).flush({ data: mockLlms1 });

    service.getLlms().subscribe((llms) => {
      expect(llms).toEqual(mockLlms1);
    });
  });

  it('should clear the cache', () => {
    const mockLlms: LLM[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

    service.getLlms().subscribe();
    httpMock.expectOne(`${LLM_LIST_API_URL}`).flush({ data: mockLlms });

    service.clearCache();

    service.getLlms().subscribe();
    httpMock.expectOne(`${LLM_LIST_API_URL}`);
  });
});
