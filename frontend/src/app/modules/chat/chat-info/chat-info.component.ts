import {
    ChangeDetectionStrategy,
    Component,
    Input,
    OnDestroy,
    ViewEncapsulation,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatDrawer } from '@angular/material/sidenav';
import { Chat } from 'app/modules/chat/chat.types';
import { User } from 'app/core/user/user.types';
import { UserService } from 'app/core/user/user.service';
import { EMPTY, Subject, catchError, takeUntil, finalize } from 'rxjs';
import { AgentLinks, GoogleCloudLinks } from "../../agents/services/agent-links";
import { MatTooltipModule } from "@angular/material/tooltip";

@Component({
    selector: 'chat-info',
    templateUrl: './chat-info.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatIconModule,
        MatSliderModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        FormsModule
    ],
})
export class ChatInfoComponent implements OnDestroy {
    @Input() chat: Chat;
    @Input() drawer: MatDrawer;
    links: AgentLinks = new GoogleCloudLinks();
    settings: User['chat'];
    loading = false;
    error: string | null = null;
    private destroy$ = new Subject<void>();

    constructor(private userService: UserService) {
        this.userService.user$
            .pipe(takeUntil(this.destroy$))
            .subscribe(user => {
                this.settings = { ...user.chat };
            });
    }

    /**
     * Saves the current chat settings to the user profile
     * Handles loading state and error display
     */
    /**
     * Saves the current chat settings to the user profile
     * Handles loading state and error display
     */
    private saveSettings(): void {
        if (!this.settings) {
            return;
        }

        this.loading = true;
        this.error = null;
        
        this.userService.update({
            chat: this.settings
        }).pipe(
            takeUntil(this.destroy$),
            catchError((error) => {
                this.error = error.error?.error || 'Failed to save settings';
                console.error('Failed to save chat settings:', error);
                return EMPTY;
            }),
            finalize(() => {
                this.loading = false;
            })
        ).subscribe();
    }

    /**
     * Handler for slider value changes
     * Triggers immediate save of updated settings
     */
    onSettingChange(): void {
        this.saveSettings();
    }

    databaseUrl(): string {
        return this.links.chatDatabaseUrl(this.chat.id);
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }
}
