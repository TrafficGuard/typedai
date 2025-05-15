import { Routes } from '@angular/router';
import { PromptsComponent } from './prompts.component';
import { PromptListComponent } from './list/prompt-list.component';

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
      // Future routes will be added here
    ]
  }
];

export default promptRoutes;
