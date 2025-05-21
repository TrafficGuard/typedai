import { SelectionModel } from '@angular/cdk/collections';
import { AsyncPipe, CommonModule, DecimalPipe } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    OnInit,
    ViewChild,
    ViewEncapsulation,
    inject,
    signal,
    effect, WritableSignal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatOptionModule, MatRippleModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { fuseAnimations } from '@fuse/animations';
import { FuseConfirmationService } from '@fuse/services/confirmation';
import { AgentService } from 'app/modules/agents/services/agent.service';
import { Subject, debounceTime, switchMap, takeUntil, finalize } from 'rxjs';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, UntypedFormControl } from '@angular/forms';
import { AgentTag, AgentType } from '#shared/model/agent.model';
import { type AgentContextApi } from '#shared/schemas/agent.schema';
import { Pagination } from '../../../core/types';

@Component({
    selector: 'inventory-list',
    templateUrl: './agent-list.component.html',
    styleUrl: './agent-list.component.scss',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: fuseAnimations,
    standalone: true,
    imports: [
        CommonModule, // For basic Angular directives like *ngIf, *ngFor
        MatProgressBarModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatTooltipModule,
        FormsModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatSortModule,
        MatPaginatorModule,
        MatSlideToggleModule,
        MatSelectModule,
        MatOptionModule,
        MatCheckboxModule,
        MatRippleModule,
        // AsyncPipe, // Keep if some observables are still used with async pipe
        DecimalPipe,
        RouterModule,
    ],
})
export class AgentListComponent implements OnInit, AfterViewInit, OnDestroy {
    @ViewChild(MatPaginator) private _paginator: MatPaginator;
    @ViewChild(MatSort) private _sort: MatSort;

    private agentService = inject(AgentService);
    private _fuseConfirmationService = inject(FuseConfirmationService);

    agents = toSignal(this.agentService.agents$, { initialValue: undefined as AgentContextApi[] | undefined });

    flashMessage: WritableSignal<'success' | 'error' | null> = signal(null);
    isLoading: WritableSignal<boolean> = signal(true); // Start with isLoading true
    searchInputControl: UntypedFormControl = new UntypedFormControl();

    selection = new SelectionModel<AgentContextApi>(true, []);

    private _unsubscribeAll: Subject<any> = new Subject<any>();

    constructor() {
        // Effect to manage isLoading state based on agents signal changes
        effect(() => {
            const currentAgents = this.agents(); // Establish dependency on the agents signal
            // This effect runs after agents() signal has been updated.
            // If data has arrived (currentAgents is not undefined), set isLoading to false.
            if (currentAgents !== undefined && this.isLoading()) {
                this.isLoading.set(false);
            }
            // If currentAgents is undefined, isLoading remains true until agents$ emits.
        }, { allowSignalWrites: true });
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    ngOnInit(): void {
        // Initial data load is triggered by AgentService constructor.
        // isLoading is initialized to true and the effect will set it to false
        // once the agents signal receives its first value (even an empty array).

        // Subscribe to search input field value changes
        this.searchInputControl.valueChanges
            .pipe(
                takeUntil(this._unsubscribeAll),
                debounceTime(300),
                switchMap((query) => {
                    if (this.isLoading()) return []; // Prevent multiple loads
                    this.isLoading.set(true);
                    this.agentService.refreshAgents(); // Triggers update to agentService.agents$
                    // The effect will handle setting isLoading to false when agents() updates.
                    return []; // switchMap expects an observable, return empty to satisfy
                }),
            )
            .subscribe();
    }

    ngAfterViewInit(): void {
        if (this._sort) { // Removed _paginator check as it's not fully used
            this._sort.sort({
                id: 'name',
                start: 'asc',
                disableClear: true,
            });

            this._sort.sortChange.pipe(takeUntil(this._unsubscribeAll)).subscribe(() => {
                if (this.isLoading()) return;
                this.isLoading.set(true);
                // if (this._paginator) this._paginator.pageIndex = 0; // If paginator is used
                this.agentService.refreshAgents();
                // Effect handles isLoading.set(false)
            });
        }
    }

    ngOnDestroy(): void {
        this._unsubscribeAll.next(null);
        this._unsubscribeAll.complete();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    getStateClass(state: string): string {
        return `state-${state.toLowerCase()}`;
    }

    isAllSelected(): boolean {
        const numSelected = this.selection.selected.length;
        const numRows = this.agents().length;
        return numSelected === numRows && numRows > 0;
    }

    masterToggle(): void {
        if (this.isAllSelected()) {
            this.selection.clear();
        } else {
            this.agents().forEach(row => this.selection.select(row));
        }
    }

    deleteSelectedAgents(): void {
        const selectedAgentIds = this.selection.selected.map((agent) => agent.agentId);
        if (selectedAgentIds.length === 0) {
            return;
        }

        const confirmation = this._fuseConfirmationService.open({
            title: 'Delete Agents',
            message: `Are you sure you want to delete ${selectedAgentIds.length} selected agent(s)? This action cannot be undone.`,
            actions: {
                confirm: {
                    label: 'Delete',
                    color: 'warn',
                },
            },
        });

        confirmation.afterClosed().subscribe((result) => {
            if (result === 'confirmed') {
                this.isLoading.set(true);
                this.agentService.deleteAgents(selectedAgentIds)
                    .pipe(
                        finalize(() => {
                            // isLoading will be set to false by the effect when agents() updates
                            // or explicitly if deleteAgents doesn't trigger agents$ update quickly enough.
                            // For now, rely on the effect. If issues, add: this.isLoading.set(false);
                        })
                    )
                    .subscribe({
                        next: () => {
                            this.selection.clear();
                            // Optionally show success message via flashMessage signal
                        },
                        error: (error) => {
                            console.error('Error deleting agents:', error);
                            this.isLoading.set(false); // Explicitly set false on error
                            // Optionally show error message via flashMessage signal
                        },
                    });
            }
        });
    }

    refreshAgents(): void {
        if (this.isLoading()) {
            return;
        }
        this.isLoading.set(true);
        this.agentService.refreshAgents();
        // Effect will set isLoading to false
    }

    createProduct(): void {
        console.log('TODO navigate to agent creation');
        // Example: inject(Router).navigate(['/ui/agents/new']);
    }

    deleteSelectedProduct(): void {
        console.warn('deleteSelectedProduct called, but deleteSelectedAgents should be used for agents.');
    }

    showFlashMessage(type: 'success' | 'error'): void {
        this.flashMessage.set(type);
        setTimeout(() => {
            this.flashMessage.set(null);
        }, 3000);
    }

    trackByFn(index: number, item: AgentContextApi): string | number {
        return item.agentId || index;
    }
}
