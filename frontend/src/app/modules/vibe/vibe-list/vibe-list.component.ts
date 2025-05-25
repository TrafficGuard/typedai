import { AsyncPipe, DatePipe, NgIf, TitleCasePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation, ChangeDetectionStrategy, signal, WritableSignal, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { VibeServiceClient } from '../vibe-service-client.service';
import {VibeSession} from "#shared/model/vibe.model";

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
		MatTooltipModule,
	],
})
export class VibeListComponent implements OnInit, OnDestroy {
	sessions$: Observable<VibeSession[]>;
	displayedColumns: string[] = ['title', 'status', 'createdAt', 'actions'];
	isLoading: WritableSignal<boolean> = signal(false);

	// Keep unsubscribe pattern if observables are subscribed manually (not needed for async pipe)
	private _unsubscribeAll: Subject<any> = new Subject<any>();

	private vibeService = inject(VibeServiceClient);
	private router = inject(Router);

	constructor() {}

	ngOnInit(): void {
		this.isLoading.set(true);
		this.sessions$ = this.vibeService.listVibeSessions().pipe(
			finalize(() => this.isLoading.set(false))
		);
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

	refreshSessions(): void {
		if (this.isLoading()) {
			return;
		}
		this.isLoading.set(true);
		// The sessions$ observable is already piped with finalize in ngOnInit,
		// which will set isLoading to false when the new data from refreshSessions arrives.
		this.vibeService.refreshSessions().subscribe();
	}

	// Optional: Add trackByFn if needed for performance with *ngFor on the table rows
	trackBySessionId(index: number, item: VibeSession): string {
		return item.id;
	}
}
