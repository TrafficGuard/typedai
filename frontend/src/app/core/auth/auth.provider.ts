import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
    EnvironmentProviders,
    Provider,
    inject,
    provideEnvironmentInitializer,
} from '@angular/core';
import { authInterceptor } from 'app/core/auth/auth.interceptor';
import { AuthService } from 'app/core/auth/auth.service';

export const provideAuth = (): Array<Provider | EnvironmentProviders> => {
    return [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideEnvironmentInitializer(() => inject(AuthService)),
    ];
};
