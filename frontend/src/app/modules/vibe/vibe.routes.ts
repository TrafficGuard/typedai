import { Routes } from '@angular/router';
import {VibeListComponent} from "./vibe-list/vibe-list.component";
import {VibeComponent} from "./vibe.component";

export default [
    {
        path: '',
        pathMatch: 'full',
        redirectTo: 'list',
    },
    {
        path: 'new',
        component: VibeComponent,
    },
    {
        path: 'list',
        component: VibeListComponent,
    },
    {
        path: ':id',
        component: VibeComponent,
    },
] as Routes;
