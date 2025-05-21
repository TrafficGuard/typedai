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

    describe('get', () => {
        it('should fetch user profile if not cached, update BehaviorSubject, and return profile through user$', (done) => {
            service.get().subscribe(user => {
                expect(user).toEqual(mockUserProfile);
                // Verify BehaviorSubject also has the value
                expect(service.user$.getValue()).toEqual(mockUserProfile);
                done();
            });

            const req = httpMock.expectOne(USER_API.view.path);
            expect(req.request.method).toBe('GET');
            req.flush(mockUserProfile);
        });

        it('should return cached user profile via user$ if available and not make HTTP call', (done) => {
            service.user = mockUserProfile; // Pre-cache the user

            service.get().subscribe(user => {
                expect(user).toEqual(mockUserProfile);
                done();
            });

            httpMock.expectNone(USER_API.view.path);
        });

        it('should handle HTTP error when fetching user profile', (done) => {
            const consoleErrorSpy = spyOn(console, 'error');

            service.get().subscribe({
                next: () => fail('should have failed with an error'),
                error: (error: Error) => {
                    expect(error.message).toBe('Error loading profile');
                    expect(consoleErrorSpy).toHaveBeenCalled();
                    done();
                }
            });

            const req = httpMock.expectOne(USER_API.view.path);
            expect(req.request.method).toBe('GET');
            req.flush('Error fetching profile', { status: 500, statusText: 'Server Error' });
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

        it('should send update request with merged profile and update BehaviorSubject on success', (done) => {
            service.update(userProfileUpdate).subscribe({
                complete: () => { // update returns Observable<void>, check on complete
                    // Verify BehaviorSubject has the value
                    expect(service.user$.getValue()).toEqual(expectedUpdatedProfile);
                    done();
                }
            });

            const req = httpMock.expectOne(USER_API.update.path);
            expect(req.request.method).toBe('POST');
            // The service sends the merged profile as the body
            expect(req.request.body).toEqual(expectedUpdatedProfile);
            req.flush(null, { status: 204, statusText: 'No Content' });
        });

        it('should handle HTTP error when updating user profile', (done) => {
            service.update(userProfileUpdate).subscribe({
                next: () => fail('should have failed with an error'),
                error: (error: HttpErrorResponse) => {
                    expect(error.status).toBe(500);
                    // Check that the BehaviorSubject was not updated
                    expect(service.user$.getValue()).toEqual(initialUserProfile);
                    done();
                }
            });

            const req = httpMock.expectOne(USER_API.update.path);
            expect(req.request.method).toBe('POST');
            req.flush('Error updating profile', { status: 500, statusText: 'Server Error' });
        });
    });
});
