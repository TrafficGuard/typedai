import { Route } from '@angular/router';
import { CodeEditComponent } from './code-edit.component';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default [
    {
        path: '', // The path is empty as it's relative to the parent route in app.routes.ts
        component: CodeEditComponent,
        title: 'Code Edit',
    },
] as Route[];
