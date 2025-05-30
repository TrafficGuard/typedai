import { Routes } from '@angular/router';
import { CodeReviewEditComponent } from './edit/code-review-edit.component';
import { CodeReviewListComponent } from './list/code-review-list.component';

export default [
	{
		path: '',
		loadComponent: () => import('./code-review.component').then((m) => m.CodeReviewComponent),
		children: [
			{
				path: '',
				component: CodeReviewListComponent,
				pathMatch: 'full', // Ensures this route matches only if the path is exactly empty
				// data: { title: marker('Code Reviews') },
			},
			{
				path: 'new',
				component: CodeReviewEditComponent,
			},
			{
				path: 'edit/:id',
				component: CodeReviewEditComponent,
			},
		],
	},
] as Routes;
