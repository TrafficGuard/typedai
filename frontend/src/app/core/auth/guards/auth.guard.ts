import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';
import { AuthService } from 'app/core/auth/auth.service';
import { of, switchMap } from 'rxjs';
import { environment } from "environments/environment";

export const AuthGuard: CanActivateFn | CanActivateChildFn = (route, state) => {
    const router: Router = inject(Router);

    return inject(AuthService)
        .check()
        .pipe(
            switchMap((authenticated) => {
                if (!authenticated) {
                    if (environment.auth === 'single_user' || environment.auth === 'google_iap') {
                        return of(true);
                    } else {
                        // Redirect to the sign-in page with a redirectURL param
                        const redirectURL =
                            state.url === '/sign-out' ? '' : `redirectURL=${state.url}`;
                        const urlTree = router.parseUrl(`/ui/sign-in?${redirectURL}`);
                        return of(urlTree);
                    }
                }
                return of(true);
            })
        );
};
