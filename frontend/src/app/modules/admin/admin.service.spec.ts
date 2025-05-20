import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AdminService } from './admin.service';
import { AdminDashboardStats } from '../../../../shared/model/admin.model';
import { adminApi } from '../../../../shared/api/admin.api';

describe('AdminService', () => {
  let service: AdminService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminService]
    });
    service = TestBed.inject(AdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify(); // Verify that no unmatched requests are outstanding.
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('fetchDashboardStats', () => {
    it('fetchDashboardStats should call GET on the correct API endpoint and return data', () => {
      const mockStats: AdminDashboardStats = { totalUsers: 10, activeAgents: 5, processedTasks: 100 } as any; // Using 'as any' to bypass strict type checking if mock data mismatches model
      const expectedPath = adminApi.getDashboardStats.path;

      service.fetchDashboardStats().subscribe(data => {
        expect(data).toEqual(mockStats);
      });

      const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
      expect(req.request.method).toBe('GET');
      req.flush(mockStats);
    });

    it('fetchDashboardStats should handle API errors', () => {
      const expectedPath = adminApi.getDashboardStats.path;

      service.fetchDashboardStats().subscribe({
        next: () => fail('should have failed with an error'),
        error: (error) => {
          expect(error).toBeTruthy(); // Or more specific error checking
        }
      });

      const req = httpMock.expectOne(request => request.url.endsWith(expectedPath));
      expect(req.request.method).toBe('GET');
      req.flush('Simulated API Error', { status: 500, statusText: 'Server Error' });
    });
  });
});
