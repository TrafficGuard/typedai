import { Routes } from '@angular/router';

export default [
	{
		path: '',
		loadComponent: () => import('./profile.component').then((m) => m.ProfileComponent),
		children: [
			{
				path: '',
				redirectTo: 'account',
				pathMatch: 'full',
			},
			{
				path: 'account',
				loadComponent: () => import('./account/account.component').then((m) => m.SettingsAccountComponent),
			},
			{
				path: 'ui',
				loadComponent: () => import('./ui-settings/ui-settings.component').then((m) => m.UiSettingsComponent),
			},
		],
	},
] as Routes;
