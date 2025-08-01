import { Route } from '@angular/router';
import { initialDataResolver } from 'app/app.resolvers';
import { AuthGuard } from 'app/core/auth/guards/auth.guard';
import { NoAuthGuard } from 'app/core/auth/guards/noAuth.guard';
import { LayoutComponent } from 'app/layout/layout.component';

// prettier-ignore
/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
export const appRoutes: Route[] = [

    // Redirect empty path to '/chat'
    {path: '', pathMatch : 'full', redirectTo: 'ui/chat'},

    // Redirect signed-in user to the '/ui/chat'
    //
    // After the user signs in, the sign-in page will redirect the user to the 'signed-in-redirect'
    // path. Below is another redirection for that path to redirect the user to the desired
    // location. This is a small convenience to keep all main routes together here on this file.
    {path: 'ui/signed-in-redirect', pathMatch : 'full', redirectTo: 'ui/chat'},

    // Auth routes for guests
    {
        path: 'ui',
        canActivate: [NoAuthGuard],
        canActivateChild: [NoAuthGuard],
        component: LayoutComponent,
        data: {
            layout: 'empty'
        },
        children: [
            {path: 'confirmation-required', loadChildren: () => import('app/modules/auth/confirmation-required/confirmation-required.routes')},
            {path: 'forgot-password', loadChildren: () => import('app/modules/auth/forgot-password/forgot-password.routes')},
            {path: 'reset-password', loadChildren: () => import('app/modules/auth/reset-password/reset-password.routes')},
            {path: 'sign-in', loadChildren: () => import('app/modules/auth/sign-in/sign-in.routes')},
            {path: 'sign-up', loadChildren: () => import('app/modules/auth/sign-up/sign-up.routes')}
        ]
    },

    // Auth routes for authenticated users
    {
        path: 'ui',
        canActivate: [AuthGuard],
        canActivateChild: [AuthGuard],
        component: LayoutComponent,
        data: {
            layout: 'empty'
        },
        children: [
            {path: 'sign-out', loadChildren: () => import('app/modules/auth/sign-out/sign-out.routes')},
            {path: 'unlock-session', loadChildren: () => import('app/modules/auth/unlock-session/unlock-session.routes')}
        ]
    },

    // Landing routes
    {
        path: 'ui',
        component: LayoutComponent,
        data: {
            layout: 'empty'
        },
        children: [
            {path: 'home', loadChildren: () => import('app/modules/landing/home/home.routes')},
        ]
    },

    // Module routes
    {
        path: 'ui',
        canActivate: [AuthGuard],
        canActivateChild: [AuthGuard],
        component: LayoutComponent,
        resolve: {
            initialData: initialDataResolver
        },
        children: [
            //{path: 'example', loadChildren: () => import('app/modules/admin/home/home.routes')},
            {path: 'profile', loadChildren: () => import('app/modules/profile/profile.routes')},
            {path: 'chat', loadChildren: () => import('app/modules/chat/chat.routes').then(m => m.default)},
            {path: 'agents', loadChildren: () => import('app/modules/agents/agent.routes')},
            {path: 'code-reviews', loadChildren: () => import('./modules/codeReview/code-review.routes')},
            {path: 'prompts', loadChildren: () => import('app/modules/prompts/prompts.routes')},
            {path: 'codeTask', loadChildren: () => import('./modules/codeTask/codeTask.routes')},
            {path: 'code-edit', loadChildren: () => import('./modules/codeEdit/code-edit.routes').then(m => m.default)},
        ]
    },
    // 404 & Catch all
    // {path: '404-not-found', pathMatch: 'full', loadChildren: () => import('app/modules/admin/pages/error/error-404/error-404.routes')},
    // {path: '**', redirectTo: '404-not-found'}
];
