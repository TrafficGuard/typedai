import { BooleanInput } from '@angular/cdk/coercion';
import { NgClass } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    OnDestroy,
    OnInit,
    forwardRef,
    inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FuseNavigationService } from '@fuse/components/navigation/navigation.service';
import { FuseNavigationItem } from '@fuse/components/navigation/navigation.types';
import { FuseVerticalNavigationBasicItemComponent } from '@fuse/components/navigation/vertical/components/basic/basic.component';
import { FuseVerticalNavigationCollapsableItemComponent } from '@fuse/components/navigation/vertical/components/collapsable/collapsable.component';
import { FuseVerticalNavigationDividerItemComponent } from '@fuse/components/navigation/vertical/components/divider/divider.component';
import { FuseVerticalNavigationSpacerItemComponent } from '@fuse/components/navigation/vertical/components/spacer/spacer.component';
import { FuseVerticalNavigationComponent } from '@fuse/components/navigation/vertical/vertical.component';
import { Subject, takeUntil } from 'rxjs';

@Component({
    selector: 'fuse-vertical-navigation-group-item',
    templateUrl: './group.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        NgClass,
        MatIconModule,
        FuseVerticalNavigationBasicItemComponent,
        FuseVerticalNavigationCollapsableItemComponent,
        FuseVerticalNavigationDividerItemComponent,
        forwardRef(() => FuseVerticalNavigationGroupItemComponent),
        FuseVerticalNavigationSpacerItemComponent,
    ],
})
export class FuseVerticalNavigationGroupItemComponent
    implements OnInit, OnDestroy
{
    /* eslint-disable @typescript-eslint/naming-convention */
    static ngAcceptInputType_autoCollapse: BooleanInput;
    /* eslint-enable @typescript-eslint/naming-convention */

    private _changeDetectorRef = inject(ChangeDetectorRef);
    private _fuseNavigationService = inject(FuseNavigationService);

    @Input() autoCollapse: boolean;
    @Input() item: FuseNavigationItem;
    @Input() name: string;

    private _fuseVerticalNavigationComponent: FuseVerticalNavigationComponent;
    private _unsubscribeAll: Subject<any> = new Subject<any>();

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    /**
     * On init
     */
    ngOnInit(): void {
        // Get the parent navigation component
        this._fuseVerticalNavigationComponent =
            this._fuseNavigationService.getComponent(this.name);

        // Subscribe to onRefreshed on the navigation component
        this._fuseVerticalNavigationComponent.onRefreshed
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

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

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
