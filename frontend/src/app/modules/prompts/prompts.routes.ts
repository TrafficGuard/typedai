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
import { PromptDetailComponent } from './detail/prompt-detail.component';


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
        path: '',
        component: PromptListComponent,
        pathMatch: 'full'
      },
      {
        path: 'new',
        component: PromptFormComponent,
        resolve: { prompt: promptResolver }
      },
      {
        path: ':promptId/edit',
        component: PromptFormComponent,
        resolve: { prompt: promptResolver }
      },
      { // New route for viewing details
        path: ':promptId',
        component: PromptDetailComponent,
        resolve: { prompt: promptResolver }
      }
    ]
  }
];

export default promptRoutes;
