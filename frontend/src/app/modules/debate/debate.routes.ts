/**
 * Debate Routes - Basic scaffolding
 *
 * Full routing structure TBD based on UI design.
 * Potential routes:
 * - /debate - list of debates or new debate form
 * - /debate/:id - view a specific debate
 * - /debate/:id/result - view debate result
 *
 * @module debate/routes
 */

import { Routes } from '@angular/router';

export default [
	{
		path: '',
		loadComponent: () => import('./debate.component').then((m) => m.DebateComponent),
		children: [
			{
				path: '',
				pathMatch: 'full',
				// TODO: Add default child route when UI is designed
				// Could be a list of debates or a new debate form
				loadComponent: () => import('./debate.component').then((m) => m.DebateComponent),
			},
			// TODO: Add route for viewing specific debate
			// {
			//   path: ':id',
			//   loadComponent: () => import('./debate-viewer/debate-viewer.component').then(m => m.DebateViewerComponent),
			// },
		],
	},
] as Routes;
