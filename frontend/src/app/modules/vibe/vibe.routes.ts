import { Routes } from '@angular/router';
import { VibeListComponent } from './vibe-list/vibe-list.component';
import { VibeComponent } from './vibe.component'; // Placeholder for new/detail view

export default [
	{
		path: '', // Changed from redirect
		component: VibeListComponent, // Use VibeListComponent directly
		// pathMatch: 'full', // Remove pathMatch if it's not a redirect
	},
	{
		path: 'new',
		component: VibeComponent, // Keep as placeholder for wizard/creation form
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
