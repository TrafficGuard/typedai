import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EMPTY, catchError, tap } from 'rxjs';
import { SlackService } from './slack.service';

type BotState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

@Component({
    selector: 'slack',
    templateUrl: './slack.component.html',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule
    ],
})
export class SlackComponent implements OnInit {
    private readonly slackService = inject(SlackService);

    readonly botState = signal<BotState>('idle');
    readonly lastAction = signal<{ type: 'started' | 'stopped'; time: Date } | null>(null);
    readonly errorMessage = signal<string | null>(null);

    readonly isRunning = computed(() => this.botState() === 'running');
    readonly isBusy = computed(() => {
        const state = this.botState();
        return state === 'starting' || state === 'stopping';
    });
    readonly canStart = computed(() => {
        const state = this.botState();
        return state === 'idle' || state === 'error';
    });
    readonly canStop = computed(() => this.botState() === 'running');

    ngOnInit(): void {
        this.refreshStatus();
    }

    startBot(): void {
        if (this.isBusy()) return;

        this.botState.set('starting');
        this.errorMessage.set(null);

        this.slackService
            .startBot()
            .pipe(
                tap(() => {
                    this.botState.set('running');
                    this.lastAction.set({ type: 'started', time: new Date() });
                }),
                catchError((error: any) => {
                    this.botState.set('error');
                    this.handleError(error, 'Failed to start Slack chatbot');
                    return EMPTY;
                }),
            )
            .subscribe();
    }

    stopBot(): void {
        if (this.isBusy()) return;

        this.botState.set('stopping');
        this.errorMessage.set(null);

        this.slackService
            .stopBot()
            .pipe(
                tap(() => {
                    this.botState.set('idle');
                    this.lastAction.set({ type: 'stopped', time: new Date() });
                }),
                catchError((error: any) => {
                    this.botState.set('error');
                    this.handleError(error, 'Failed to stop Slack chatbot');
                    return EMPTY;
                }),
            )
            .subscribe();
    }

    resetBot(): void {
        this.botState.set('idle');
        this.errorMessage.set(null);
        this.lastAction.set(null);
    }

    private refreshStatus(): void {
        this.slackService
            .getStatus()
            .pipe(
                tap((response) => {
                    this.botState.set(response.status === 'connected' ? 'running' : 'idle');
                }),
                catchError((error: any) => {
                    this.botState.set('error');
                    this.handleError(error, 'Failed to load Slack chatbot status');
                    return EMPTY;
                }),
            )
            .subscribe();
    }

    private handleError(error: any, fallbackMessage: string): void {
        const message = error?.error?.error || error?.message || fallbackMessage;
        this.errorMessage.set(typeof message === 'string' ? message : fallbackMessage);
    }
}
