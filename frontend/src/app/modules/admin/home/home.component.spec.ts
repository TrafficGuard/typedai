import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { CommonModule } from '@angular/common';
import { of, throwError } from 'rxjs';

import { HomeComponent } from './home.component';
import { AdminService } from '../admin.service';
import { AdminDashboardStats } from '../../../../../shared/model/admin.model';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let mockAdminService: jasmine.SpyObj<AdminService>;

  beforeEach(async () => {
    mockAdminService = jasmine.createSpyObj('AdminService', ['fetchDashboardStats']);

    await TestBed.configureTestingModule({
      imports: [HomeComponent, HttpClientTestingModule, CommonModule], // HomeComponent is standalone
      providers: [
        { provide: AdminService, useValue: mockAdminService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('ngOnInit should call loadDashboardStats', () => {
    spyOn(component, 'loadDashboardStats'); // Spy on the instance method
    fixture.detectChanges(); // Triggers ngOnInit
    expect(component.loadDashboardStats).toHaveBeenCalled();
  });

  it('should have correct initial signal states before ngOnInit', () => {
    // Note: ngOnInit is triggered by the first fixture.detectChanges()
    // This test checks state before that, or if ngOnInit wasn't auto-called.
    // If loadDashboardStats sets isLoading to true sync, this might be tricky.
    // Default signal values are tested here.
    expect(component.stats()).toBeUndefined();
    // isLoading initial state is false as per signal definition, loadDashboardStats sets it to true.
    // If ngOnInit is not called yet, isLoading should be its initial signal value.
    // If fixture.detectChanges() is called in a test, ngOnInit runs.
    expect(component.isLoading()).toBe(false); 
    expect(component.errorMessage()).toBeUndefined();
  });

  describe('loadDashboardStats', () => {
    it('loadDashboardStats should update signals correctly on successful API call', fakeAsync(() => {
      const mockStats: AdminDashboardStats = { totalUsers: 10, activeAgents: 5, processedTasks: 100 } as any; // Using 'as any' to bypass strict type checking if mock data mismatches model
      mockAdminService.fetchDashboardStats.and.returnValue(of(mockStats));

      component.loadDashboardStats();
      // isLoading is set to true synchronously at the start of loadDashboardStats
      expect(component.isLoading()).toBe(true); 
      tick(); // Complete the observable subscription

      expect(component.stats()).toEqual(mockStats);
      expect(component.isLoading()).toBeFalse();
      expect(component.errorMessage()).toBeUndefined();
      expect(mockAdminService.fetchDashboardStats).toHaveBeenCalled();
    }));

    it('loadDashboardStats should update signals correctly on failed API call', fakeAsync(() => {
      mockAdminService.fetchDashboardStats.and.returnValue(throwError(() => new Error('API Error')));

      component.loadDashboardStats();
      // isLoading is set to true synchronously at the start of loadDashboardStats
      expect(component.isLoading()).toBe(true);
      tick(); // Complete the observable subscription

      expect(component.errorMessage()).toBe('Could not load dashboard statistics. Please try again later.');
      expect(component.isLoading()).toBeFalse();
      expect(component.stats()).toBeUndefined();
      expect(mockAdminService.fetchDashboardStats).toHaveBeenCalled();
    }));
  });

  it.skip('should display loading indicator when isLoading is true', () => {
    // TODO: Implement template test for loading indicator
  });
});
