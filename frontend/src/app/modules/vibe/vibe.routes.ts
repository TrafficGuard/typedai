import { Routes } from '@angular/router';
import { VibeListComponent } from './vibe-list/vibe-list.component';
import { VibeComponent } from './vibe.component'; // Placeholder for detail view
import { NewVibeWizardComponent } from './new-vibe-wizard/new-vibe-wizard.component'; // Import the new wizard component

export default [
	{
		path: '', // Changed from redirect
		component: VibeListComponent, // Use VibeListComponent directly
		// pathMatch: 'full', // Remove pathMatch if it's not a redirect
	},
	{
		path: 'new',
		component: NewVibeWizardComponent, // Use the new wizard component
	},
	// Remove the '/list' route as '' now points to VibeListComponent
	// {
	//     path: 'list',
	//     component: VibeListComponent,
	// },
	{
		path: ':id', // Keep for viewing/editing a specific session
		component: VibeComponent, // Or a dedicated detail component later
	},
] as Routes;
