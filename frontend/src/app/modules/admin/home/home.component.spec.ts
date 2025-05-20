import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';

import { HomeComponent } from './home.component';
import { AdminService } from '../admin.service';
import { AdminDashboardStats } from '../../../../../shared/model/admin.model';
import { ChangeDetectionStrategy }
from '@angular/core';

describe('AdminHomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let adminServiceSpy: jasmine.SpyObj<AdminService>;

  const mockAdminDashboardStats: AdminDashboardStats = {
    activeUsers: 100,
    totalProjects: 50,
  };

  beforeEach(async () => {
    adminServiceSpy = jasmine.createSpyObj('AdminService', ['fetchDashboardStats']);

    await TestBed.configureTestingModule({
      imports: [HomeComponent, HttpClientTestingModule], // HomeComponent is standalone
      providers: [
        { provide: AdminService, useValue: adminServiceSpy },
      ],
    })
    // Override component's change detection strategy for testing if necessary,
    // but it's better to test with the actual strategy.
    // .overrideComponent(HomeComponent, {
    //   set: { changeDetection: ChangeDetectionStrategy.Default }
    // })
    .compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have correct initial signal states', () => {
    fixture.detectChanges(); // Trigger initial data binding and ngOnInit
    expect(component.stats()).toBeUndefined();
    expect(component.isLoading()).toBe(true); // ngOnInit calls loadDashboardStats, which sets isLoading to true initially
    expect(component.errorMessage()).toBeUndefined();
  });

  describe('loadDashboardStats', () => {
    it('should load dashboard stats successfully and update signals', fakeAsync(() => {
      adminServiceSpy.fetchDashboardStats.and.returnValue(of(mockAdminDashboardStats));

      component.ngOnInit(); // Calls loadDashboardStats
      // fixture.detectChanges(); // ngOnInit calls loadDashboardStats

      expect(component.isLoading()).toBe(true);

      tick(); // Allow Observable to emit
      fixture.detectChanges();

      expect(adminServiceSpy.fetchDashboardStats).toHaveBeenCalled();
      expect(component.stats()).toEqual(mockAdminDashboardStats);
      expect(component.isLoading()).toBe(false);
      expect(component.errorMessage()).toBeUndefined();
    }));

    it('should handle error when fetching dashboard stats and update signals', fakeAsync(() => {
      const errorResponse = { status: 500, message: 'Server Error' };
      adminServiceSpy.fetchDashboardStats.and.returnValue(throwError(() => errorResponse));

      component.ngOnInit(); // Calls loadDashboardStats
      // fixture.detectChanges();

      expect(component.isLoading()).toBe(true);

      tick(); // Allow Observable to emit error
      fixture.detectChanges();

      expect(adminServiceSpy.fetchDashboardStats).toHaveBeenCalled();
      expect(component.stats()).toBeUndefined();
      expect(component.isLoading()).toBe(false);
      expect(component.errorMessage()).toBe('Could not load dashboard statistics. Please try again later.');
    }));
  });
});
