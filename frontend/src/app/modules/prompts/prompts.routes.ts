import { Routes, ActivatedRouteSnapshot, ResolveFn, RouterStateSnapshot } from '@angular/router';
import { inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { PromptsComponent } from './prompts.component';
import { PromptListComponent } from './list/prompt-list.component';
import { PromptFormComponent } from './form/prompt-form.component';
import { PromptsService } from './prompts.service';
import type { Prompt } from '#shared/model/prompts.model';
import type { PromptSchemaModel } from '#shared/schemas/prompts.schema';
import { PROMPTS_ROUTES } from './prompt.paths';


export const promptResolver: ResolveFn<Prompt | null> = (
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
): Observable<Prompt | null> => {
    const promptsService = inject(PromptsService);
    const promptId = route.paramMap.get('promptId');
    if (promptId) {
        return promptsService.getPromptById(promptId).pipe(
            map(promptSchema => promptSchema as Prompt), // The service already updates its internal signal
            catchError(() => {
                console.error(`Failed to load prompt with id: ${promptId}`);
                promptsService.clearSelectedPrompt(); // Clear if resolution fails
                return of(null);
            })
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
        pathMatch: 'full'
      },
      {
        path: PROMPTS_ROUTES.PATH_NEW,
        component: PromptFormComponent,
        resolve: { prompt: promptResolver }
      },
      {
        path: PROMPTS_ROUTES.PATH_EDIT, // This is ':promptId/edit'
        component: PromptFormComponent,
        resolve: { prompt: promptResolver }
      }
    ]
  }
];

export default promptRoutes;
