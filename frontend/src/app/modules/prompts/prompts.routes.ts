import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, ResolveFn, RouterStateSnapshot, Routes } from '@angular/router';
import { type Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Prompt } from '#shared/prompts/prompts.model';
import { PromptSchemaModel } from '#shared/prompts/prompts.schema';
import { PromptFormComponent } from './form/prompt-form.component';
import { PromptListComponent } from './list/prompt-list.component';
import { PROMPTS_ROUTES } from './prompt.paths';
import { PromptsComponent } from './prompts.component';
import { PromptsService } from './prompts.service';

export const promptResolver: ResolveFn<Prompt | null> = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<Prompt | null> => {
	const promptsService = inject(PromptsService);
	const promptId = route.paramMap.get('promptId');
	if (promptId) {
		return promptsService.getPromptById(promptId).pipe(
			map((promptSchema) => promptSchema as Prompt), // The service already updates its internal signal
			catchError(() => {
				console.error(`Failed to load prompt with id: ${promptId}`);
				promptsService.clearSelectedPrompt(); // Clear if resolution fails
				return of(null);
			}),
		);
	}
	promptsService.clearSelectedPrompt(); // Clear if no promptId (e.g. for 'new' route)
	return of(null);
};

const promptRoutes: Routes = [
	{
		path: '',
		component: PromptsComponent,
		children: [
			{
				path: PROMPTS_ROUTES.PATH_LIST,
				component: PromptListComponent,
				pathMatch: 'full',
			},
			{
				path: PROMPTS_ROUTES.PATH_NEW,
				component: PromptFormComponent,
				resolve: { prompt: promptResolver },
			},
			{
				path: PROMPTS_ROUTES.PATH_EDIT, // This is ':promptId/edit'
				component: PromptFormComponent,
				resolve: { prompt: promptResolver },
			},
		],
	},
];

export default promptRoutes;
