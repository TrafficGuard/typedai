import { Component, type OnDestroy, type OnInit, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { FuseFullscreenComponent } from '@fuse/components/fullscreen';
import { FuseLoadingBarComponent } from '@fuse/components/loading-bar';
import { FuseHorizontalNavigationComponent, type FuseNavigationService, FuseVerticalNavigationComponent } from '@fuse/components/navigation';
import type { FuseMediaWatcherService } from '@fuse/services/media-watcher';
import type { NavigationService } from 'app/core/navigation/navigation.service';
import type { Navigation } from 'app/core/navigation/navigation.types';
import { NotificationsComponent } from 'app/layout/common/notifications/notifications.component';
import { ShortcutsComponent } from 'app/layout/common/shortcuts/shortcuts.component';
import { UserComponent } from 'app/layout/common/user/user.component';
import { Subject, takeUntil } from 'rxjs';
import { QuickChatComponent } from '../../../common/quick-chat/quick-chat.component';
import { QuickListComponent } from '../../../common/quick-list/quick-list.component';

@Component({
	selector: 'modern-layout',
	templateUrl: './modern.component.html',
	encapsulation: ViewEncapsulation.None,
	standalone: true,
	imports: [
		FuseLoadingBarComponent,
		FuseVerticalNavigationComponent,
		FuseHorizontalNavigationComponent,
		MatButtonModule,
		MatIconModule,
		FuseFullscreenComponent,
		// NotificationsComponent,
		UserComponent,
		RouterOutlet,
		ShortcutsComponent,
		// QuickListComponent,
		// QuickChatComponent,
	],
})
export class ModernLayoutComponent implements OnInit, OnDestroy {
	isScreenSmall: boolean;
	navigation: Navigation;
	private _unsubscribeAll: Subject<any> = new Subject<any>();

	/**
	 * Constructor
	 */
	constructor(
		private _activatedRoute: ActivatedRoute,
		private _router: Router,
		private _navigationService: NavigationService,
		private _fuseMediaWatcherService: FuseMediaWatcherService,
		private _fuseNavigationService: FuseNavigationService,
	) {}

	// -----------------------------------------------------------------------------------------------------
	// @ Accessors
	// -----------------------------------------------------------------------------------------------------

	/**
	 * Getter for current year
	 */
	get currentYear(): number {
		return new Date().getFullYear();
	}

	// -----------------------------------------------------------------------------------------------------
	// @ Lifecycle hooks
	// -----------------------------------------------------------------------------------------------------

	ngOnInit(): void {
		// Subscribe to navigation data
		this._navigationService.navigation$.pipe(takeUntil(this._unsubscribeAll)).subscribe((navigation: Navigation) => {
			this.navigation = navigation;
		});

		// Subscribe to media changes
		this._fuseMediaWatcherService.onMediaChange$.pipe(takeUntil(this._unsubscribeAll)).subscribe(({ matchingAliases }) => {
			this.isScreenSmall = !matchingAliases.includes('md');
		});
	}

	ngOnDestroy(): void {
		this._unsubscribeAll.next(null);
		this._unsubscribeAll.complete();
	}

	// -----------------------------------------------------------------------------------------------------
	// @ Public methods
	// -----------------------------------------------------------------------------------------------------

	/**
	 * @param name
	 */
	toggleNavigation(name: string): void {
		const navigation = this._fuseNavigationService.getComponent<FuseVerticalNavigationComponent>(name);
		navigation?.toggle();
	}
}
