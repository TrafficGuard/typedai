import { NgTemplateOutlet } from '@angular/common';
import {
    AfterViewInit,
    Component,
    Input,
    OnChanges,
    SimpleChanges,
    TemplateRef,
    ViewEncapsulation,
} from '@angular/core';
import { fuseAnimations } from '@fuse/animations';

@Component({
    selector: 'fuse-masonry',
    templateUrl: './masonry.component.html',
    encapsulation: ViewEncapsulation.None,
    animations: fuseAnimations,
    exportAs: 'fuseMasonry',
    imports: [NgTemplateOutlet],
})
export class FuseMasonryComponent implements OnChanges, AfterViewInit {
    @Input() columnsTemplate: TemplateRef<any>;
    @Input() columns: number;
    @Input() items: any[] = [];
    distributedColumns: any[] = [];

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    /**
     * On changes
     *
     * @param changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        // Columns
        if ('columns' in changes) {
            // Distribute the items
            this._distributeItems();
        }

        // Items
        if ('items' in changes) {
            // Distribute the items
            this._distributeItems();
        }
    }

    /**
     * After view init
     */
    ngAfterViewInit(): void {
        // Distribute the items for the first time
        this._distributeItems();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Distribute items into columns
     */
    private _distributeItems(): void {
        // Return an empty array if there are no items
        if (this.items.length === 0) {
            this.distributedColumns = [];
            return;
        }

        // Prepare the distributed columns array
        this.distributedColumns = Array.from(Array(this.columns), (item) => ({
            items: [],
        }));

        // Distribute the items to columns
        for (let i = 0; i < this.items.length; i++) {
            this.distributedColumns[i % this.columns].items.push(this.items[i]);
        }
    }
}
