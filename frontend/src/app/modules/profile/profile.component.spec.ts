import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { FuseMediaWatcherService } from '@fuse/services/media-watcher';
import { UserProfile } from '#shared/user/user.model';
import { UserService } from 'app/core/user/user.service';

xdescribe('ProfileComponent', () => {
	let component: ProfileComponent;
	let fixture: ComponentFixture<ProfileComponent>;
	let mockUserService: jasmine.SpyObj<UserService>;
	let mockFuseMediaWatcherService: jasmine.SpyObj<FuseMediaWatcherService>;

	const mockUser: UserProfile = {
		id: '1',
		name: 'Test User',
		email: 'test@example.com',
		enabled: true,
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
		// mockFuseMediaWatcherService.onMediaChange$ = of({ matchingAliases: ['lg'] }); // onMediaChange$ is readonly

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
						events: of({}), // Mock router events
					},
				},
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

		}));

		it('should set error signal if user profile loading fails', fakeAsync(() => {

		}));
	});
});
