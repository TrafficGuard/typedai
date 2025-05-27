import { TestBed, fakeAsync, tick } from '@angular/core/testing';
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

  it('should load LLMs and update state', fakeAsync(() => {
    const mockLlms: LLM[] = [
      { id: 'llm1', name: 'LLM 1', isConfigured: true },
      { id: 'llm2', name: 'LLM 2', isConfigured: false },
    ];

    service.getLlms();

    // Verify loading state
    expect(service.llmsState().status).toBe('loading');

    const req = httpMock.expectOne(`${LLM_LIST_API_URL}`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: mockLlms });
    tick();

    // Verify success state
    const state = service.llmsState();
    expect(state.status).toBe('success');
    if (state.status === 'success') {
      expect(state.data).toEqual(mockLlms);
    }
  }));

  it('should not make duplicate requests when already loading', fakeAsync(() => {
    const mockLlms: LLM[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

    service.getLlms();
    service.getLlms(); // Second call should be ignored

    // Only one request should be made
    const req = httpMock.expectOne(`${LLM_LIST_API_URL}`);
    req.flush({ data: mockLlms });
    tick();

    const state = service.llmsState();
    expect(state.status).toBe('success');
    if (state.status === 'success') {
      expect(state.data).toEqual(mockLlms);
    }
  }));

  it('should refresh LLMs when clearCache is called', fakeAsync(() => {
    const mockLlms: LLM[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

    service.getLlms();
    const req1 = httpMock.expectOne(`${LLM_LIST_API_URL}`);
    req1.flush({ data: mockLlms });
    tick();

    service.clearCache();

    const req2 = httpMock.expectOne(`${LLM_LIST_API_URL}`);
    req2.flush({ data: mockLlms });
    tick();

    const state = service.llmsState();
    expect(state.status).toBe('success');
  }));

  it('should handle errors and update state', fakeAsync(() => {
    service.getLlms();

    const req = httpMock.expectOne(`${LLM_LIST_API_URL}`);
    req.error(new ErrorEvent('Network error'), { status: 500 });
    tick();

    const state = service.llmsState();
    expect(state.status).toBe('error');
    if (state.status === 'error') {
      expect(state.error.message).toBe('Failed to load LLMs');
      expect(state.code).toBe(500);
    }
  }));

  it('should provide backward compatibility with llms$ observable', fakeAsync(() => {
    const mockLlms: LLM[] = [{ id: 'llm1', name: 'LLM 1', isConfigured: true }];

    let observedLlms: LLM[] = [];
    service.llms$.subscribe(llms => observedLlms = llms);

    service.getLlms();
    const req = httpMock.expectOne(`${LLM_LIST_API_URL}`);
    req.flush({ data: mockLlms });
    tick();

    expect(observedLlms).toEqual(mockLlms);
  }));
});
