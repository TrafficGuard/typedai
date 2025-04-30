import { Routes } from '@angular/router';
import {CodeReviewEditComponent} from "./edit/code-review-edit.component";
import {CodeReviewListComponent} from "./list/code-review-list.component";

export default [
    {
        path: '',
        component: CodeReviewListComponent,
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
] as Routes;
