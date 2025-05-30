import { NgClass } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { FuseConfig, FuseConfigService, Scheme, Theme, Themes } from '@fuse/services/config';
import { LocalStorageService } from 'app/core/services/local-storage.service';

import { Subject, takeUntil } from 'rxjs';

@Component({
	selector: 'ui-settings',
	templateUrl: './ui-settings.component.html',
	encapsulation: ViewEncapsulation.None,
	standalone: true,
	imports: [MatIconModule, MatButtonModule, NgClass, MatTooltipModule],
})
export class UiSettingsComponent implements OnInit, OnDestroy {
	config: FuseConfig;
	layout: string;
	scheme: 'dark' | 'light';
	theme: string;
	themes: Themes;
	private readonly _unsubscribeAll = new Subject<any>();

	constructor(
		private _router: Router,
		private _fuseConfigService: FuseConfigService,
		private _localStorageService: LocalStorageService,
	) {}

	// @ Lifecycle hooks --------------------------------------

	ngOnInit(): void {
		// Subscribe to config changes
		this._fuseConfigService.config$.pipe(takeUntil(this._unsubscribeAll)).subscribe((config: FuseConfig) => {
			this.config = config;
		});
	}

	ngOnDestroy(): void {
		// Unsubscribe from all subscriptions
		this._unsubscribeAll.next(null);
		this._unsubscribeAll.complete();
	}

	// @ Public methods --------------------------------------

	/**
	 * Set the layout on the config
	 * @param layout
	 */
	setLayout(layout: string): void {
		this._fuseConfigService.config = { layout };
		this._localStorageService.setLayout(layout);
	}

	/**
	 * Set the scheme on the config
	 * @param scheme
	 */
	setScheme(scheme: Scheme): void {
		this._fuseConfigService.config = { scheme };
		this._localStorageService.setScheme(scheme);
	}

	/**
	 * Set the theme on the config
	 *
	 * @param theme
	 */
	setTheme(theme: Theme): void {
		this._fuseConfigService.config = { theme };
	}
}
