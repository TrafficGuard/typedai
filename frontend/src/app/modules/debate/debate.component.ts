/**
 * Debate Component - Main container for the multi-agent debate UI
 *
 * This is basic scaffolding. Full implementation TBD based on UI design.
 *
 * @module debate/component
 */

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
	selector: 'debate',
	templateUrl: './debate.component.html',
	styleUrls: ['./debate.component.scss'],
	encapsulation: ViewEncapsulation.None,
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [CommonModule, RouterOutlet],
})
export class DebateComponent {}
