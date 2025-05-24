import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    OnInit,
    ViewEncapsulation,
    WritableSignal,
    effect,
    inject,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterModule } from '@angular/router';
import { Static } from '@sinclair/typebox';
import { Subject } from 'rxjs';

import { VibeSessionListItemApiSchema } from '#shared/schemas/vibe.schema';
import { VibeServiceClient } from './vibe-service-client.service';

// Define the TypeScript type for list items based on the API schema
type VibeSessionListItem = Static<typeof VibeSessionListItemApiSchema>;

@Component({
    selector: 'app-vibe-list',
    templateUrl: './vibe-list.component.html',
    styleUrls: ['./vibe-list.component.scss'],
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [CommonModule, RouterModule, MatProgressBarModule],
})
export class VibeListComponent implements OnInit, OnDestroy {
    private vibeService = inject(VibeServiceClient);
    private router = inject(Router);

    sessions = toSignal(this.vibeService.vibeSessionsListItems$, {
        initialValue: undefined as VibeSessionListItem[] | undefined | null,
    });
    isLoading: WritableSignal<boolean> = signal(true);

    private _unsubscribeAll: Subject<any> = new Subject<any>();

    constructor() {
        effect(
            () => {
                const currentSessions = this.sessions();
                if (currentSessions !== undefined && this.isLoading()) {
                    this.isLoading.set(false);
                }
            },
            { allowSignalWrites: true },
        );
    }

    ngOnInit(): void {
        // Trigger initial data load.
        // Assumes vibeSessionsListItems$ might be a cold observable or require an explicit trigger.
        this.refreshVibeSessions();
    }

    ngOnDestroy(): void {
        this._unsubscribeAll.next(null);
        this._unsubscribeAll.complete();
    }

    public refreshVibeSessions(): void {
        if (this.isLoading()) {
            return;
        }
        this.isLoading.set(true);
        // Assumes refreshVibeSessionsListItems() exists on vibeService and triggers
        // the vibeSessionsListItems$ observable to emit.
        this.vibeService.refreshVibeSessionsListItems();
        // The effect will set isLoading to false when sessions() updates.
    }

    trackBySessionId(index: number, item: VibeSessionListItem): string {
        return item.id;
    }

    // Example navigation method, can be expanded or removed if not needed.
    navigateToCreateVibeSession(): void {
        this.router.navigate(['/vibes/new']); // Adjust route as necessary
    }
}
