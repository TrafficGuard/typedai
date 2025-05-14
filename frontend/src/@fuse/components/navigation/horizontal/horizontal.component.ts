import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewEncapsulation,
    inject,
} from '@angular/core';
import { fuseAnimations } from '@fuse/animations';
import { FuseNavigationService } from '@fuse/components/navigation/navigation.service';
import { FuseNavigationItem } from '@fuse/components/navigation/navigation.types';
import { FuseUtilsService } from '@fuse/services/utils/utils.service';
import { ReplaySubject, Subject } from 'rxjs';
import { FuseHorizontalNavigationBasicItemComponent } from './components/basic/basic.component';
import { FuseHorizontalNavigationBranchItemComponent } from './components/branch/branch.component';
import { FuseHorizontalNavigationSpacerItemComponent } from './components/spacer/spacer.component';

@Component({
    selector: 'fuse-horizontal-navigation',
    templateUrl: './horizontal.component.html',
    styleUrls: ['./horizontal.component.scss'],
    animations: fuseAnimations,
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    exportAs: 'fuseHorizontalNavigation',
    imports: [
        FuseHorizontalNavigationBasicItemComponent,
        FuseHorizontalNavigationBranchItemComponent,
        FuseHorizontalNavigationSpacerItemComponent,
    ],
})
export class FuseHorizontalNavigationComponent
    implements OnChanges, OnInit, OnDestroy
{
    private _changeDetectorRef = inject(ChangeDetectorRef);
    private _fuseNavigationService = inject(FuseNavigationService);
    private _fuseUtilsService = inject(FuseUtilsService);

    @Input() name: string = this._fuseUtilsService.randomId();
    @Input() navigation: FuseNavigationItem[];

    onRefreshed: ReplaySubject<boolean> = new ReplaySubject<boolean>(1);
    private _unsubscribeAll: Subject<any> = new Subject<any>();

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    /**
     * On changes
     *
     * @param changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        // Navigation
        if ('navigation' in changes) {
            // Mark for check
            this._changeDetectorRef.markForCheck();
        }
    }

    /**
     * On init
     */
    ngOnInit(): void {
        // Make sure the name input is not an empty string
        if (this.name === '') {
            this.name = this._fuseUtilsService.randomId();
        }

        // Register the navigation component
        this._fuseNavigationService.registerComponent(this.name, this);
    }

    /**
     * On destroy
     */
    ngOnDestroy(): void {
        // Deregister the navigation component from the registry
        this._fuseNavigationService.deregisterComponent(this.name);

        // Unsubscribe from all subscriptions
        this._unsubscribeAll.next(null);
        this._unsubscribeAll.complete();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Refresh the component to apply the changes
     */
    refresh(): void {
        // Mark for check
        this._changeDetectorRef.markForCheck();

        // Execute the observable
        this.onRefreshed.next(true);
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
