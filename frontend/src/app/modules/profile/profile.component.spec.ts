import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { ProfileComponent } from './profile.component';
import { UserService } from '../../../core/user/user.service';

import { MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FuseMediaWatcherService } from '@fuse/services/media-watcher';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import {UserProfile} from "#shared/user/user.model";

describe('ProfileComponent', () => {
    let component: ProfileComponent;
    let fixture: ComponentFixture<ProfileComponent>;
    let mockUserService: jasmine.SpyObj<UserService>;
    let mockFuseMediaWatcherService: jasmine.SpyObj<FuseMediaWatcherService>;

    const mockUser: UserProfile = {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        enabled: true,
        createdAt: new Date(),
        hilBudget: 0,
        hilCount: 0,
        llmConfig: {},
        chat: {},
        functionConfig: {},
    };

    beforeEach(async () => {
        mockUserService = jasmine.createSpyObj('UserService', ['user$']);
        // Initialize user$ with a BehaviorSubject so it has a current value for initial subscription
        (mockUserService as any).user$ = new BehaviorSubject<UserProfile | null>(null);

        mockFuseMediaWatcherService = jasmine.createSpyObj('FuseMediaWatcherService', ['onMediaChange$']);
        mockFuseMediaWatcherService.onMediaChange$ = of({ matchingAliases: ['lg'] });


        await TestBed.configureTestingModule({
            imports: [
                ProfileComponent, // Import standalone component directly
                CommonModule,
                RouterTestingModule.withRoutes([]), // Basic router testing setup
                NoopAnimationsModule, // For Angular Material components
                MatSidenavModule,
                MatButtonModule,
                MatIconModule,
            ],
            providers: [
                { provide: UserService, useValue: mockUserService },
                { provide: FuseMediaWatcherService, useValue: mockFuseMediaWatcherService },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { paramMap: convertToParamMap({}) },
                        firstChild: null, // Mock as needed for specific tests
                        url: of([]), // Mock as needed
                        events: of({}) // Mock router events
                    }
                }
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ProfileComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        fixture.detectChanges(); // Trigger ngOnInit
        expect(component).toBeTruthy();
    });

    describe('User Data Fetching', () => {
        it('should load user profile on init and update signals', fakeAsync(() => {
            (mockUserService as any).user$.next(mockUser); // Simulate user emission
            fixture.detectChanges(); // Trigger ngOnInit
            tick(); // Process observables

            expect(component.isLoading()).toBe(false);
            expect(component.currentUser()).toEqual(mockUser);
            expect(component.error()).toBeNull();
        }));

        it('should set error signal if user profile loading fails', fakeAsync(() => {
            (mockUserService as any).user$ = throwError(() => new Error('Failed to load'));
            fixture.detectChanges(); // Trigger ngOnInit
            tick(); // Process observables

            expect(component.isLoading()).toBe(false);
            expect(component.currentUser()).toBeNull();
            expect(component.error()).toBe('Failed to load user profile.');
        }));

        it('should set isLoading to true initially and then to false after loading', fakeAsync(() => {
            const userSubject = new BehaviorSubject<UserProfile | null>(null);
            (mockUserService as any).user$ = userSubject.asObservable();

            fixture.detectChanges(); // ngOnInit
            expect(component.isLoading()).toBe(true); // Check initial loading state

            userSubject.next(mockUser);
            tick(); // Process observable emission
            fixture.detectChanges(); // Update view with new signal values

            expect(component.isLoading()).toBe(false); // Check loading state after success
            expect(component.currentUser()).toEqual(mockUser);

            // Test error case for isLoading
            userSubject.error(new Error('fail'));
            tick();
            fixture.detectChanges();
            expect(component.isLoading()).toBe(false); // Check loading state after error
        }));
    });

    // Add more tests for panel navigation, drawer interactions, etc.
    // For example, testing router navigation on goToPanel or selectedPanel signal updates
});
