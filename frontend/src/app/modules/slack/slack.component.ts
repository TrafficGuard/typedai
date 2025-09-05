import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

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
export class SlackComponent {
    botState: BotState = 'idle';
    lastAction: { type: string; time: Date } | null = null;
    errorMessage: string | null = null;

    get isRunning(): boolean {
        return this.botState === 'running';
    }

    startBot() {
        this.botState = 'starting';
        this.errorMessage = null;
        
        // Simulate API call
        setTimeout(() => {
            this.botState = 'running';
            this.lastAction = { type: 'started', time: new Date() };
            console.log('Starting Slack bot...');
        }, 2000);
    }

    stopBot() {
        this.botState = 'stopping';
        this.errorMessage = null;
        
        // Simulate API call
        setTimeout(() => {
            this.botState = 'idle';
            this.lastAction = { type: 'stopped', time: new Date() };
            console.log('Stopping Slack bot...');
        }, 1500);
    }

    resetBot() {
        this.botState = 'idle';
        this.errorMessage = null;
        this.lastAction = null;
    }
}
