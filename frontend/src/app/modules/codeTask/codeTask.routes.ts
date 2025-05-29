import type { Routes } from '@angular/router';
import { CodeTaskComponent } from './codeTask.component';
import { CodeTaskListComponent } from './codeTaskList/codeTaskList.component';
import { NewCodeTaskComponent } from './newCodeTask/newCodeTask.component';

export default [
	{
		path: '',
		component: CodeTaskListComponent,
	},
	{
		path: 'new',
		component: NewCodeTaskComponent,
	},
	{
		path: ':id',
		component: CodeTaskComponent,
	},
] as Routes;
