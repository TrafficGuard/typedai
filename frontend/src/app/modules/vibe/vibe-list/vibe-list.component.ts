import { AsyncPipe, DatePipe, NgIf, TitleCasePipe, CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
		CommonModule,
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
export class VibeListComponent implements OnInit {
	displayedColumns: string[] = ['title', 'status', 'createdAt', 'actions'];

	private vibeService = inject(VibeServiceClient);
	private router = inject(Router);

	readonly sessionsState = this.vibeService.sessionsState;

	readonly isLoading = computed(() => this.sessionsState().status === 'loading');

	readonly sessions$ = this.vibeService.sessions$;

	ngOnInit(): void {
		this.loadSessions();
	}

	loadSessions(): void {
		this.vibeService.loadSessions();
	}

	createNewVibe(): void {
		this.router.navigate(['/ui/vibe/new']);
	}

	viewVibe(sessionId: string): void {
		this.router.navigate(['/ui/vibe', sessionId]);
	}

	refreshSessions(): void {
		this.vibeService.loadSessions();
	}

	trackBySessionId(index: number, item: VibeSession): string {
		return item.id;
	}
}
