// import { TestBed, fakeAsync, tick } from '@angular/core/testing';
// import {
//     HttpClientTestingModule,
//     HttpTestingController,
// } from '@angular/common/http/testing';
// import { Router } from '@angular/router';
// import { AuthService } from './auth.service';
// import { UserService } from 'app/core/user/user.service';
// import { AuthUtils } from 'app/core/auth/auth.utils';
// import { environment } from '../../../environments/environment';
// import { SharedTypes } from '../../shared';
// import { of, throwError } from 'rxjs';

// describe('AuthService', () => {
//     let service: AuthService;
//     let httpMock: HttpTestingController;
//     let userServiceMock: jasmine.SpyObj<UserService>;
//     let routerMock: jasmine.SpyObj<Router>;
//     let sharedTypesMock: jasmine.SpyObj<SharedTypes>;

//     let localStorageStore: { [key: string]: string } = {};
//     const originalEnvironmentAuth = environment.auth;

//     beforeEach(() => {
//         localStorageStore = {};
//         spyOn(localStorage, 'getItem').and.callFake((key: string) => {
//             return localStorageStore[key] || null;
//         });
//         spyOn(localStorage, 'setItem').and.callFake(
//             (key: string, value: string) => {
//                 localStorageStore[key] = value;
//             }
//         );
//         spyOn(localStorage, 'removeItem').and.callFake((key: string) => {
//             delete localStorageStore[key];
//         });

//         userServiceMock = jasmine.createSpyObj('UserService', ['get'], { user: null }); // Added 'get' spy
//         routerMock = jasmine.createSpyObj('Router', ['navigate']);
//         sharedTypesMock = jasmine.createSpyObj('SharedTypes', ['']); // Mock for SharedTypes

//         TestBed.configureTestingModule({
//             imports: [HttpClientTestingModule],
//             providers: [
//                 AuthService,
//                 { provide: UserService, useValue: userServiceMock },
//                 { provide: Router, useValue: routerMock },
//                 { provide: SharedTypes, useValue: sharedTypesMock },
//             ],
//         });

//         service = TestBed.inject(AuthService);
//         httpMock = TestBed.inject(HttpTestingController);
//         // Reset environment.auth to its original value before each test
//         (environment as any).auth = originalEnvironmentAuth;
//     });

//     afterEach(() => {
//         httpMock.verify();
//         // Ensure environment.auth is reset after each test
//         (environment as any).auth = originalEnvironmentAuth;
//     });

//     it('should be created', () => {
//         expect(service).toBeTruthy();
//     });

//     describe('accessToken', () => {
//         it('should set and get accessToken from localStorage', () => {
//             service.accessToken = 'test-token';
//             expect(localStorage.setItem).toHaveBeenCalledWith(
//                 'accessToken',
//                 'test-token'
//             );
//             expect(service.accessToken).toBe('test-token');
//             expect(localStorage.getItem).toHaveBeenCalledWith('accessToken');
//         });

//         it('should return empty string if no accessToken in localStorage', () => {
//             expect(service.accessToken).toBe('');
//         });
//     });

//     describe('forgotPassword', () => {
//         it('should send a POST request to api/auth/forgot-password', fakeAsync(() => {
//             const email = 'test@example.com';
//             service.forgotPassword(email).subscribe();
//             tick();

//             const req = httpMock.expectOne('api/auth/forgot-password');
//             expect(req.request.method).toBe('POST');
//             expect(req.request.body).toBe(email);
//             req.flush({});
//         }));
//     });

//     describe('resetPassword', () => {
//         it('should send a POST request to api/auth/reset-password', fakeAsync(() => {
//             const password = 'newPassword123';
//             service.resetPassword(password).subscribe();
//             tick();

//             const req = httpMock.expectOne('api/auth/reset-password');
//             expect(req.request.method).toBe('POST');
//             expect(req.request.body).toBe(password);
//             req.flush({});
//         }));
//     });

//     describe('signIn', () => {
//         const credentials = { email: 'test@example.com', password: 'password' };
//         const mockUser = { id: '1', name: 'Test User', email: credentials.email, enabled: true, createdAt: new Date(), hilBudget:0, hilCount: 0 };
//         const mockResponse = { accessToken: 'new-token', user: mockUser };

//         it('should throw an error if already authenticated', fakeAsync(() => {
//             // Simulate authenticated state
//             service.accessToken = 'existing-token';
//             (service as any)._authenticated = true;

//             let errorThrown: any;
//             service.signIn(credentials).subscribe({
//                 error: (err) => (errorThrown = err),
//             });
//             tick();

//             expect(errorThrown).toBe('User is already logged in.');
//             expect((service as any)._authenticated).toBeTrue(); // Should remain true
//         }));

//         it('should sign in successfully, store token and user', fakeAsync(() => {
//             (service as any)._authenticated = false; // Ensure not authenticated initially

//             service.signIn(credentials).subscribe();
//             tick();

//             const req = httpMock.expectOne('/api/auth/signin');
//             expect(req.request.method).toBe('POST');
//             expect(req.request.body).toEqual(credentials);
//             req.flush(mockResponse);
//             tick();

//             expect(service.accessToken).toBe('new-token');
//             expect((service as any)._authenticated).toBeTrue();
//             expect(userServiceMock.user).toEqual(mockUser);
//         }));

//         it('should handle sign-in error', fakeAsync(() => {
//             (service as any)._authenticated = false;
//             let errorResponse: any;
//             service.signIn(credentials).subscribe({
//                 error: (err) => errorResponse = err
//             });
//             tick();

//             const req = httpMock.expectOne('/api/auth/signin');
//             req.flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });
//             tick();

//             expect(errorResponse).toBeTruthy();
//             expect(service.accessToken).toBe(''); // Token should not be set
//             expect((service as any)._authenticated).toBeFalse(); // Should remain false
//             expect(userServiceMock.user).toBeNull(); // User should not be set
//         }));
//     });

//     describe('signInUsingToken', () => {
//         const mockUser = { id: '1', name: 'Test User', email: 'test@example.com', enabled: true, createdAt: new Date(), hilBudget:0, hilCount: 0 };

//         it('should sign in with token successfully and update token if new one is provided', fakeAsync(() => {
//             service.accessToken = 'old-token';
//             const mockServerResponse = { accessToken: 'new-fresh-token', user: mockUser };

//             let result: any;
//             service.signInUsingToken().subscribe(res => result = res);
//             tick();

//             const req = httpMock.expectOne('api/auth/sign-in-with-token');
//             expect(req.request.method).toBe('POST');
//             expect(req.request.body).toEqual({ accessToken: 'old-token' });
//             req.flush(mockServerResponse);
//             tick();

//             expect(result).toBeTrue();
//             expect(service.accessToken).toBe('new-fresh-token');
//             expect((service as any)._authenticated).toBeTrue();
//             expect(userServiceMock.user).toEqual(mockUser);
//         }));

//         it('should sign in with token successfully even if no new token is provided in response', fakeAsync(() => {
//             service.accessToken = 'current-token';
//             const mockServerResponse = { user: mockUser }; // No accessToken in response

//             let result: any;
//             service.signInUsingToken().subscribe(res => result = res);
//             tick();

//             const req = httpMock.expectOne('api/auth/sign-in-with-token');
//             req.flush(mockServerResponse);
//             tick();

//             expect(result).toBeTrue();
//             expect(service.accessToken).toBe('current-token'); // Should remain the same
//             expect((service as any)._authenticated).toBeTrue();
//             expect(userServiceMock.user).toEqual(mockUser);
//         }));


//         it('should handle error during sign in with token', fakeAsync(() => {
//             service.accessToken = 'invalid-token';
//             let result: any;
//             service.signInUsingToken().subscribe(res => result = res);
//             tick();

//             const req = httpMock.expectOne('api/auth/sign-in-with-token');
//             req.flush({ message: 'Token invalid' }, { status: 401, statusText: 'Unauthorized' });
//             tick();

//             expect(result).toBeFalse();
//             expect((service as any)._authenticated).toBeFalse(); // Should be false after failed attempt
//             expect(userServiceMock.user).toBeNull();
//         }));
//     });

//     describe('signOut', () => {
//         it('should remove accessToken, set authenticated to false', fakeAsync(() => {
//             service.accessToken = 'some-token';
//             (service as any)._authenticated = true;

//             let result: any;
//             service.signOut().subscribe(res => result = res);
//             tick();

//             expect(result).toBeTrue();
//             expect(service.accessToken).toBe('');
//             expect(localStorage.removeItem).toHaveBeenCalledWith('accessToken');
//             expect((service as any)._authenticated).toBeFalse();
//         }));
//     });

//     describe('signUp', () => {
//         it('should send a POST request to /api/auth/signup', fakeAsync(() => {
//             const userDetails = { email: 'new@example.com', password: 'password123' };
//             service.signUp(userDetails).subscribe();
//             tick();

//             const req = httpMock.expectOne('/api/auth/signup');
//             expect(req.request.method).toBe('POST');
//             expect(req.request.body).toEqual(userDetails);
//             req.flush({});
//         }));
//     });

//     describe('unlockSession', () => {
//         it('should send a POST request to /api/auth/unlock-session', fakeAsync(() => {
//             const credentials = { email: 'test@example.com', password: 'password' };
//             service.unlockSession(credentials).subscribe();
//             tick();

//             const req = httpMock.expectOne('/api/auth/unlock-session');
//             expect(req.request.method).toBe('POST');
//             expect(req.request.body).toEqual(credentials);
//             req.flush({});
//         }));
//     });

//     describe('check', () => {
//         const mockUser = { id: '1', name: 'Test User', email: 'test@example.com', enabled: true, createdAt: new Date(), hilBudget:0, hilCount: 0 };

//         it('should return true if already authenticated', fakeAsync(() => {
//             (service as any)._authenticated = true;
//             let result: boolean | undefined;
//             service.check().subscribe(res => result = res);
//             tick();
//             expect(result).toBeTrue();
//         }));

//         it('should check via userService if auth is "google_iap"', fakeAsync(() => {
//             (environment as any).auth = 'google_iap';
//             (service as any)._authenticated = false;
//             userServiceMock.get.and.returnValue(of(mockUser));

//             let result: boolean | undefined;
//             service.check().subscribe(res => result = res);
//             tick();

//             expect(userServiceMock.get).toHaveBeenCalled();
//             expect((service as any)._authenticated).toBeTrue();
//             expect(result).toBeTrue();
//         }));

//         it('should check via userService if auth is "single_user"', fakeAsync(() => {
//             (environment as any).auth = 'single_user';
//             (service as any)._authenticated = false;
//             userServiceMock.get.and.returnValue(of(mockUser));

//             let result: boolean | undefined;
//             service.check().subscribe(res => result = res);
//             tick();

//             expect(userServiceMock.get).toHaveBeenCalled();
//             expect((service as any)._authenticated).toBeTrue();
//             expect(result).toBeTrue();
//         }));

//         it('should return false if not IAP/single_user, no accessToken', fakeAsync(() => {
//             (environment as any).auth = 'default_auth';
//             (service as any)._authenticated = false;
//             service.accessToken = ''; // Ensure no token

//             let result: boolean | undefined;
//             service.check().subscribe(res => result = res);
//             tick();
//             expect(result).toBeFalse();
//         }));

//         it('should return false if not IAP/single_user, token is expired', fakeAsync(() => {
//             (environment as any).auth = 'default_auth';
//             (service as any)._authenticated = false;
//             service.accessToken = 'expired-token';
//             spyOn(AuthUtils, 'isTokenExpired').and.returnValue(true);

//             let result: boolean | undefined;
//             service.check().subscribe(res => result = res);
//             tick();

//             expect(AuthUtils.isTokenExpired).toHaveBeenCalledWith('expired-token');
//             expect(result).toBeFalse();
//         }));

//         it('should call signInUsingToken if not IAP/single_user, token exists and is not expired', fakeAsync(() => {
//             (environment as any).auth = 'default_auth';
//             (service as any)._authenticated = false;
//             service.accessToken = 'valid-token';
//             spyOn(AuthUtils, 'isTokenExpired').and.returnValue(false);
//             // Spy on signInUsingToken to check if it's called
//             spyOn(service, 'signInUsingToken').and.returnValue(of(true));


//             let result: boolean | undefined;
//             service.check().subscribe(res => result = res);
//             tick();

//             expect(AuthUtils.isTokenExpired).toHaveBeenCalledWith('valid-token');
//             expect(service.signInUsingToken).toHaveBeenCalled();
//             expect(result).toBeTrue();
//         }));

//         it('should handle error from userService.get for IAP/single_user', fakeAsync(() => {
//             (environment as any).auth = 'single_user';
//             (service as any)._authenticated = false;
//             userServiceMock.get.and.returnValue(throwError(() => new Error('Failed to fetch user')));

//             let errorThrown: any;
//             service.check().subscribe({
//                 error: (err) => errorThrown = err,
//             });
//             tick();

//             expect(userServiceMock.get).toHaveBeenCalled();
//             expect((service as any)._authenticated).toBeFalse(); // Should remain false
//             expect(errorThrown).toBeTruthy();
//             expect(errorThrown.message).toBe('Failed to fetch user');
//         }));
//     });
// });
