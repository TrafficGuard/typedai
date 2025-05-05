import { AsyncPipe, DatePipe, NgIf, TitleCasePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { VibeService } from '../vibe.service';
import { VibeSession } from '../vibe.types';

@Component({
	selector: 'vibe-list',
	templateUrl: './vibe-list.component.html',
	styleUrls: ['./vibe-list.component.scss'],
	encapsulation: ViewEncapsulation.None,
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [
		NgIf,
		AsyncPipe,
		DatePipe,
		TitleCasePipe,
		MatButtonModule,
		MatIconModule,
		MatTableModule,
	],
})
export class VibeListComponent implements OnInit, OnDestroy {
	sessions$: Observable<VibeSession[]>;
	displayedColumns: string[] = ['title', 'status', 'createdAt', 'actions'];

	// Keep unsubscribe pattern if observables are subscribed manually (not needed for async pipe)
	private _unsubscribeAll: Subject<any> = new Subject<any>();

	constructor(
		private vibeService: VibeService,
		private router: Router,
	) {}

	ngOnInit(): void {
		this.sessions$ = this.vibeService.listVibeSessions();
	}

	ngOnDestroy(): void {
		this._unsubscribeAll.next(null);
		this._unsubscribeAll.complete();
	}

	createNewVibe(): void {
		this.router.navigate(['/ui/vibe/new']); // Navigate to the new vibe route
	}

	viewVibe(sessionId: string): void {
		this.router.navigate(['/ui/vibe', sessionId]);
	}

	// Optional: Add trackByFn if needed for performance with *ngFor on the table rows
	trackBySessionId(index: number, item: VibeSession): string {
		return item.id;
	}
}
