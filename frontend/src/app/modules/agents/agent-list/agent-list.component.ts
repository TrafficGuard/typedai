import { SelectionModel } from '@angular/cdk/collections';
import { CommonModule, DecimalPipe } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    OnInit,
    ViewChild,
    ViewEncapsulation,
    inject,
    signal,
    computed, WritableSignal,
    DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { AgentService } from '../agent.service';
import { debounceTime, switchMap, finalize } from 'rxjs';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, UntypedFormControl } from '@angular/forms';
import {type AgentContextPreview, AgentTag, AgentType} from '#shared/agent/agent.model';
import { AGENT_ROUTE_DEFINITIONS } from '../agent.routes';
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
export class AgentListComponent implements OnInit, AfterViewInit {
    @ViewChild(MatPaginator) private _paginator: MatPaginator;
    @ViewChild(MatSort) private _sort: MatSort;

    private agentService = inject(AgentService);
    private _fuseConfirmationService = inject(FuseConfirmationService);
    private readonly destroyRef = inject(DestroyRef);

    readonly agentsState = this.agentService.agentsState;
    readonly routes = AGENT_ROUTE_DEFINITIONS;

    flashMessage: WritableSignal<'success' | 'error' | null> = signal(null);
    isLoading = computed(() => {
        const currentState = this.agentsState();
        return currentState.status === 'loading' || currentState.status === 'idle';
    });
    searchInputControl: UntypedFormControl = new UntypedFormControl();

    selection = new SelectionModel<AgentContextPreview>(true, []);

    constructor() {
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Lifecycle hooks
    // -----------------------------------------------------------------------------------------------------

    ngOnInit(): void {
        // Initial data load is triggered by AgentService constructor.
        // isLoading is computed from agentsState and will be true initially
        // until the agents signal receives its first value (even an empty array).

        // Subscribe to search input field value changes
        this.searchInputControl.valueChanges
            .pipe(
                takeUntilDestroyed(this.destroyRef),
                debounceTime(300),
                switchMap((query) => {
                    if (this.isLoading()) return []; // Prevent multiple loads
                    this.agentService.refreshAgents(); // Triggers update to agentService.agents$
                    return []; // switchMap expects an observable, return empty to satisfy
                }),
            )
            .subscribe();
        this.refreshAgents();
    }

    ngAfterViewInit(): void {
        if (this._sort) { // Removed _paginator check as it's not fully used
            this._sort.sort({
                id: 'name',
                start: 'asc',
                disableClear: true,
            });

            this._sort.sortChange.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
                if (this.isLoading()) return;
                // if (this._paginator) this._paginator.pageIndex = 0; // If paginator is used
                this.agentService.refreshAgents();
            });
        }
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    getStateClass(state: string): string {
        return `state-${state.toLowerCase()}`;
    }

    isAllSelected(): boolean {
        const currentState = this.agentsState();
        if (currentState.status !== 'success' || !currentState.data) {
            return false;
        }
        const numSelected = this.selection.selected.length;
        const numRows = currentState.data.length;
        return numSelected === numRows && numRows > 0;
    }

    masterToggle(): void {
        const currentState = this.agentsState();
        if (currentState.status !== 'success' || !currentState.data) {
            return;
        }
        if (this.isAllSelected()) {
            this.selection.clear();
        } else {
            currentState.data.forEach(row => this.selection.select(row));
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
                this.agentService.deleteAgents(selectedAgentIds)
                    .pipe(
                        takeUntilDestroyed(this.destroyRef),
                        finalize(() => {
                            // isLoading is computed from agentsState and will update automatically
                        })
                    )
                    .subscribe({
                        next: () => {
                            this.selection.clear();
                            // Optionally show success message via flashMessage signal
                        },
                        error: (error) => {
                            console.error('Error deleting agents:', error);
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
        this.agentService.refreshAgents();
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

    trackByFn(index: number, item: AgentContextPreview): string | number {
        return item.agentId || index;
    }
}
