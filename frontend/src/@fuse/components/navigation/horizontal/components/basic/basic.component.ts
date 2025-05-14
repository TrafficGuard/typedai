import { NgClass, NgTemplateOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    OnDestroy,
    OnInit,
    inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
    IsActiveMatchOptions,
    RouterLink,
    RouterLinkActive,
} from '@angular/router';
import { FuseHorizontalNavigationComponent } from '@fuse/components/navigation/horizontal/horizontal.component';
import { FuseNavigationService } from '@fuse/components/navigation/navigation.service';
import { FuseNavigationItem } from '@fuse/components/navigation/navigation.types';
import { FuseUtilsService } from '@fuse/services/utils/utils.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
    selector: 'fuse-horizontal-navigation-basic-item',
    templateUrl: './basic.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        NgClass,
        RouterLink,
        RouterLinkActive,
        MatTooltipModule,
        NgTemplateOutlet,
        MatMenuModule,
        MatIconModule,
    ],
})
export class FuseHorizontalNavigationBasicItemComponent
    implements OnInit, OnDestroy
{
    private _changeDetectorRef = inject(ChangeDetectorRef);
    private _fuseNavigationService = inject(FuseNavigationService);
    private _fuseUtilsService = inject(FuseUtilsService);

    @Input() item: FuseNavigationItem;
    @Input() name: string;

    // Set the equivalent of {exact: false} as default for active match options.
    // We are not assigning the item.isActiveMatchOptions directly to the
    // [routerLinkActiveOptions] because if it's "undefined" initially, the router
    // will throw an error and stop working.
    isActiveMatchOptions: IsActiveMatchOptions =
        this._fuseUtilsService.subsetMatchOptions;

    private _fuseHorizontalNavigationComponent: FuseHorizontalNavigationComponent;
    private _unsubscribeAll: Subject<any> = new Subject<any>();

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    /**
     * On init
     */
    ngOnInit(): void {
        // Set the "isActiveMatchOptions" either from item's
        // "isActiveMatchOptions" or the equivalent form of
        // item's "exactMatch" option
        this.isActiveMatchOptions =
            this.item.isActiveMatchOptions ?? this.item.exactMatch
                ? this._fuseUtilsService.exactMatchOptions
                : this._fuseUtilsService.subsetMatchOptions;

        // Get the parent navigation component
        this._fuseHorizontalNavigationComponent =
            this._fuseNavigationService.getComponent(this.name);

        // Mark for check
        this._changeDetectorRef.markForCheck();

        // Subscribe to onRefreshed on the navigation component
        this._fuseHorizontalNavigationComponent.onRefreshed
            .pipe(takeUntil(this._unsubscribeAll))
            .subscribe(() => {
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
}
