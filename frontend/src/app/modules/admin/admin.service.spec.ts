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
      providers: [AdminService],
    });
    service = TestBed.inject(AdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify(); // Verify that no unmatched requests are outstanding
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('fetchDashboardStats', () => {
    it('should fetch dashboard stats successfully', () => {
      const mockStats: AdminDashboardStats = {
        activeUsers: 120,
        totalProjects: 75,
      };

      service.fetchDashboardStats().subscribe(stats => {
        expect(stats).toEqual(mockStats);
      });

      const req = httpMock.expectOne(adminApi.getDashboardStats.path);
      expect(req.request.method).toBe('GET');
      req.flush(mockStats);
    });

    it('should handle errors when fetching dashboard stats', () => {
      const errorMessage = 'Http failure response for /api/admin/dashboard-stats: 500 Internal Server Error';
      const mockError = { status: 500, statusText: 'Internal Server Error' };

      service.fetchDashboardStats().subscribe({
        next: () => fail('should have failed with the 500 error'),
        error: (error) => {
          // Check a more generic error message or specific parts if callApiRoute transforms it
          expect(error).toBeTruthy();
          // Depending on how callApiRoute handles errors, the exact error object might differ.
          // For now, just check that an error is propagated.
        },
      });

      const req = httpMock.expectOne(adminApi.getDashboardStats.path);
      expect(req.request.method).toBe('GET');
      req.flush(null, mockError); // Respond with error
    });
  });
});
