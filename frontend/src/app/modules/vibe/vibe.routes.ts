import { Routes } from '@angular/router';
import { VibeListComponent } from './vibe-list/vibe-list.component';
import { VibeComponent } from './vibe.component';
import { NewVibeWizardComponent } from './new-vibe-wizard/new-vibe-wizard.component';

export default [
	{
		path: '',
		component: VibeListComponent,
	},
	{
		path: 'new',
		component: NewVibeWizardComponent,
	},
	{
		path: ':id',
		component: VibeComponent,
	},
] as Routes;
