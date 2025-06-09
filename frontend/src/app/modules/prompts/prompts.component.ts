import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
	selector: 'app-prompts',
	standalone: true,
	imports: [RouterModule],
	template: `<div class="flex flex-col flex-auto h-full"><router-outlet></router-outlet></div>`,
})
export class PromptsComponent {}
