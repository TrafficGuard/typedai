import { CommonModule, NgClass } from '@angular/common';
import {
	ChangeDetectionStrategy,
	ChangeDetectorRef,
	Component,
	type OnDestroy,
	type OnInit,
	ViewChild,
	ViewEncapsulation,
	computed,
	inject,
	signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { type MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { FuseMediaWatcherService } from '@fuse/services/media-watcher';
import { Subject, filter, takeUntil } from 'rxjs';
import { UserProfile } from '#shared/user/user.model';
import { UserService } from '../../core/user/user.service';

@Component({
	selector: 'settings',
	templateUrl: './profile.component.html',
	encapsulation: ViewEncapsulation.None,
	changeDetection: ChangeDetectionStrategy.OnPush,
	standalone: true,
	imports: [
		CommonModule,
		RouterModule,
		MatSidenavModule,
		MatButtonModule,
		MatIconModule,
		// SettingsAccountComponent and UiSettingsComponent are now loaded via router
	],
})
export class ProfileComponent implements OnInit, OnDestroy {
	@ViewChild('drawer') drawer: MatDrawer;
	drawerMode: 'over' | 'side' = 'side';
	drawerOpened = true;
	panels: any[] = [];
	private _unsubscribeAll: Subject<any> = new Subject();

	private userService = inject(UserService);
	private router = inject(Router);
	private activatedRoute = inject(ActivatedRoute);
	private _changeDetectorRef = inject(ChangeDetectorRef); // Keep for FuseMediaWatcherService
	private _fuseMediaWatcherService = inject(FuseMediaWatcherService); // Keep for drawer logic

	private userProfile = computed(() => this.userService.userProfile());

	selectedPanel = signal<string>('account'); // Default panel

	/**
	 * Get panel from URL hash
	 * @private
	 */
	private getPanelFromHash(): string {
		const hash = window.location.hash.slice(1);
		return this.panels.find((panel) => panel.id === hash)?.id || 'account';
	}

	/**
	 * Update URL hash - This will be handled by the router.
	 * @private
	 */
	/*
    private updateUrlHash(panel: string): void {
        window.location.hash = panel === 'account' ? '' : panel;
    }
    */

	// -----------------------------------------------------------------------------------------------------
	// @ Lifecycle hooks
	// -----------------------------------------------------------------------------------------------------

	/**
	 * On init
	 */
	ngOnInit(): void {
		// Setup available panels
		this.panels = [
			{
				id: 'account',
				icon: 'heroicons_outline:user-circle',
				title: 'Account',
				description: 'Manage your profile and LLM API keys',
			},
			// {
			//     id: 'security',
			//     icon: 'heroicons_outline:lock-closed',
			//     title: 'Security',
			//     description:
			//         'Manage your password and 2-step verification preferences',
			// },
			// {
			//     id: 'notifications',
			//     icon: 'heroicons_outline:bell',
			//     title: 'Notifications',
			//     description: "Manage when you'll be notified on which channels",
			// },
			{
				id: 'ui',
				icon: 'heroicons_outline:user-group',
				title: 'UI',
				description: 'Theme, layout and scheme settings',
			},
		];

		// Subscribe to router events to update selectedPanel signal
		this.router.events
			.pipe(
				filter((event): event is NavigationEnd => event instanceof NavigationEnd),
				takeUntil(this._unsubscribeAll),
			)
			.subscribe((event: NavigationEnd) => {
				const firstChild = this.activatedRoute.firstChild;
				if (firstChild) {
					const childRoutePath = firstChild.snapshot.url[0]?.path;
					if (childRoutePath && this.panels.some((p) => p.id === childRoutePath)) {
						this.selectedPanel.set(childRoutePath);
					} else {
						this.selectedPanel.set('account'); // Default if no match
					}
				} else {
					// When at parent route /profile before redirecting to a child
					const panelFromHash = this.getPanelFromHash();
					this.selectedPanel.set(panelFromHash);
				}
			});

		// Handle initial navigation based on hash
		const panelIdFromHash = window.location.hash.slice(1);
		if (panelIdFromHash && this.panels.some((p) => p.id === panelIdFromHash)) {
			const currentChildPath = this.activatedRoute.firstChild?.snapshot.url[0]?.path;
			if (currentChildPath !== panelIdFromHash) {
				this.router.navigate([panelIdFromHash], { relativeTo: this.activatedRoute, replaceUrl: true });
			}
		}
		// If no hash, the default child route redirect in profile.routes.ts will handle it.

		// Subscribe to media changes for drawer
		this._fuseMediaWatcherService.onMediaChange$.pipe(takeUntil(this._unsubscribeAll)).subscribe(({ matchingAliases }) => {
			// Set the drawerMode and drawerOpened
			if (matchingAliases.includes('lg')) {
				this.drawerMode = 'side';
				this.drawerOpened = true;
			} else {
				this.drawerMode = 'over';
				this.drawerOpened = false;
			}

			// Mark for check
			this._changeDetectorRef.markForCheck();
		});
	}

	/**
	 * On destroy
	 */
	ngOnDestroy(): void {
		// Unsubscribe from all subscriptions
		this._unsubscribeAll.next(null);
		this._unsubscribeAll.complete();
	}

	// -----------------------------------------------------------------------------------------------------
	// @ Public methods
	// -----------------------------------------------------------------------------------------------------

	/**
	 * Navigate to the panel
	 *
	 * @param panel
	 */
	goToPanel(panel: string): void {
		this.router.navigate([panel], { relativeTo: this.activatedRoute });
		// The selectedPanel signal is updated by router event subscription.
		// The updateUrlHash method is no longer needed.

		// Close the drawer on 'over' mode
		if (this.drawerMode === 'over') {
			this.drawer.close();
		}
	}

	/**
	 * Get the details of the panel
	 *
	 * @param id
	 */
	getPanelInfo(id: string): any {
		return this.panels.find((panel) => panel.id === id);
	}

	/**
	 * Track by function for ngFor loops
	 *
	 * @param index
	 * @param item
	 */
	trackByFn(index: number, item: any): any {
		return item.id || index;
	}
}
