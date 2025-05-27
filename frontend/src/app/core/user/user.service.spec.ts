import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { UserService } from './user.service';
import { UserProfile } from '#shared/schemas/user.schema';
import { USER_API } from '#shared/api/user.api';
import { HttpErrorResponse } from '@angular/common/http';

describe('UserService', () => {
    let service: UserService;
    let httpMock: HttpTestingController;

    // UserProfileProps = ['id', 'name', 'email', 'enabled', 'hilBudget', 'hilCount', 'llmConfig', 'chat', 'functionConfig']
    const mockUserProfile: UserProfile = {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        enabled: true,
        hilBudget: 100,
        hilCount: 10,
        llmConfig: { openaiKey: 'mockOpenAIKey' },
        chat: { defaultLLM: 'mockLLM' },
        functionConfig: { mockFunction: { enabled: true } },
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [UserService],
        });
        service = TestBed.inject(UserService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify(); // Verify that no unmatched requests are outstanding.
    });

    describe('loadUser', () => {
        it('should set loading state, fetch user profile, and update state to success', () => {
            service.loadUser();

            // Verify loading state is set
            expect(service.userState().status).toBe('loading');

            const req = httpMock.expectOne(USER_API.view.path);
            expect(req.request.method).toBe('GET');
            req.flush(mockUserProfile);

            // Verify success state with user data
            expect(service.userState().status).toBe('success');
            expect((service.userState() as any).data).toEqual(mockUserProfile);
        });

        it('should not make HTTP call if already loading', () => {
            service.loadUser();
            service.loadUser(); // Second call should be ignored

            const req = httpMock.expectOne(USER_API.view.path);
            expect(req.request.method).toBe('GET');
            req.flush(mockUserProfile);
        });

        it('should handle HTTP error and set error state', () => {
            const consoleErrorSpy = spyOn(console, 'error');

            service.loadUser();

            const req = httpMock.expectOne(USER_API.view.path);
            expect(req.request.method).toBe('GET');
            req.flush('Error fetching profile', { status: 500, statusText: 'Server Error' });

            // Verify error state
            expect(service.userState().status).toBe('error');
            expect((service.userState() as any).error.message).toBe('Error loading profile');
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });

    describe('getUser', () => {
        it('should call loadUser', () => {
            spyOn(service, 'loadUser');
            service.getUser();
            expect(service.loadUser).toHaveBeenCalled();
        });
    });

    describe('user$ backward compatibility', () => {
        it('should return user data when state is success', (done) => {
            service.user = mockUserProfile;

            service.user$.subscribe(user => {
                expect(user).toEqual(mockUserProfile);
                done();
            });
        });

        it('should return null when state is not success', (done) => {
            service.user$.subscribe(user => {
                expect(user).toBeNull();
                done();
            });
        });
    });

    describe('get method', () => {
        it('should trigger loadUser and return user$ observable', (done) => {
            spyOn(service, 'loadUser');
            
            service.user = mockUserProfile;
            
            service.get().subscribe(user => {
                expect(service.loadUser).toHaveBeenCalled();
                expect(user).toEqual(mockUserProfile);
                done();
            });
        });
    });

    describe('user setter', () => {
        it('should set success state when user is provided', () => {
            service.user = mockUserProfile;
            expect(service.userState().status).toBe('success');
            expect((service.userState() as any).data).toEqual(mockUserProfile);
        });

        it('should set idle state when user is null', () => {
            service.user = null;
            expect(service.userState().status).toBe('idle');
        });
    });

    describe('update', () => {
        const initialUserProfile: UserProfile = {
            id: '1',
            name: 'Initial Name',
            email: 'initial@example.com',
            enabled: true,
            hilBudget: 50,
            hilCount: 5,
            llmConfig: { openaiKey: 'initialOpenAIKey' },
            chat: { defaultLLM: 'initialLLM', temperature: 0.7 },
            functionConfig: { initialFunc: { settingA: true } },
        };

        const userProfileUpdate: Partial<UserProfile> = {
            name: 'Updated Name',
            hilBudget: 75,
            // Example of updating nested config; ensure your actual update logic handles this if needed
            // For this service, it's a shallow merge, so nested updates need to be complete objects
            chat: { defaultLLM: 'updatedLLM', temperature: 0.8 },
        };

        // The service's update method does a shallow merge: {...this._user.value, ...userProfileUpdate}
        // So, llmConfig and functionConfig will come from initialUserProfile.
        // chat will be entirely replaced by userProfileUpdate.chat.
        const expectedUpdatedProfile: UserProfile = {
            ...initialUserProfile, // Start with initial
            name: userProfileUpdate.name, // Apply specific updates
            hilBudget: userProfileUpdate.hilBudget,
            chat: userProfileUpdate.chat, // chat is replaced entirely
        };


        beforeEach(() => {
            // Set an initial user for update tests
            service.user = initialUserProfile;
        });

        it('should send update request with merged profile and update state on success', (done) => {
            service.update(userProfileUpdate).subscribe({
                complete: () => { // update returns Observable<void>, check on complete
                    // Verify state has the updated value
                    const state = service.userState();
                    expect(state.status).toBe('success');
                    if (state.status === 'success') {
                        expect(state.data).toEqual(expectedUpdatedProfile);
                    }
                    done();
                }
            });

            const req = httpMock.expectOne(USER_API.update.path);
            expect(req.request.method).toBe('POST');
            // The service sends the update payload as the body
            expect(req.request.body).toEqual(userProfileUpdate);
            req.flush(null, { status: 204, statusText: 'No Content' });
        });

        it('should handle HTTP error when updating user profile', (done) => {
            service.update(userProfileUpdate).subscribe({
                next: () => fail('should have failed with an error'),
                error: (error: HttpErrorResponse) => {
                    expect(error.status).toBe(500);
                    // Check that the state was not updated
                    const state = service.userState();
                    expect(state.status).toBe('success');
                    if (state.status === 'success') {
                        expect(state.data).toEqual(initialUserProfile);
                    }
                    done();
                }
            });

            const req = httpMock.expectOne(USER_API.update.path);
            expect(req.request.method).toBe('POST');
            req.flush('Error updating profile', { status: 500, statusText: 'Server Error' });
        });
    });
});
