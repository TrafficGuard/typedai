import { SelectionModel } from '@angular/cdk/collections';
import { AsyncPipe, DecimalPipe } from '@angular/common';
import {
	AfterViewInit,
	ChangeDetectionStrategy,
	ChangeDetectorRef,
	Component,
	OnDestroy,
	OnInit,
	ViewChild,
	ViewEncapsulation,
} from '@angular/core';
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
import { Observable, Subject, debounceTime, switchMap, takeUntil } from 'rxjs';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, UntypedFormControl} from "@angular/forms";
import { AgentTag, AgentType } from "#shared/model/agent.model";
import { type AgentContextApi } from '#shared/schemas/agent.schema';
import {Pagination} from "../../../core/types";

@Component({
	selector: 'inventory-list',
	templateUrl: './agent-list.component.html',
	styleUrl: './agent-list.component.scss',
	encapsulation: ViewEncapsulation.None,
	changeDetection: ChangeDetectionStrategy.OnPush,
	animations: fuseAnimations,
	standalone: true,
	imports: [
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
		AsyncPipe,
		DecimalPipe,
		RouterModule,
	],
})
export class AgentListComponent implements OnInit, AfterViewInit, OnDestroy {
	@ViewChild(MatPaginator) private _paginator: MatPaginator;
	@ViewChild(MatSort) private _sort: MatSort;

	agents$: Observable<AgentContextApi[]>

	agentTypes: AgentType[];
	filteredTags: AgentTag[];
	flashMessage: 'success' | 'error' | null = null;
	isLoading = false;
	pagination: Pagination;
	searchInputControl: UntypedFormControl = new UntypedFormControl();
	tags: AgentTag[];
	tagsEditMode = false;

	selection = new SelectionModel<AgentContextApi>(true, []);

	private _unsubscribeAll: Subject<any> = new Subject<any>();

	/**
	 * Constructor
	 */
	constructor(
		private _changeDetectorRef: ChangeDetectorRef,
		private _fuseConfirmationService: FuseConfirmationService,
		private _formBuilder: UntypedFormBuilder,
		private agentService: AgentService,
	) {}

	// -----------------------------------------------------------------------------------------------------
	// @ Lifecycle hooks
	// -----------------------------------------------------------------------------------------------------

	/**
	 * On init
	 */
	ngOnInit(): void {
		// Get the pagination - Note: This seems unused currently based on the template
		// this._inventoryService.pagination$
		//     .pipe(takeUntil(this._unsubscribeAll))
		//     .subscribe((pagination: AgentPagination) => {
		//         // Update the pagination
		//         this.pagination = pagination;
		//
		//         // Mark for check
		//         this._changeDetectorRef.markForCheck();
		//     });

		// Get the agents observable
		this.agents$ = this.agentService.agents$;

		// Initial Load - Manage isLoading
		this.isLoading = true; // Start loading on init
		// this.agentService.refreshAgents(); // Trigger initial load via refreshAgents/loadAgents

		this.agentService.agents$.pipe(takeUntil(this._unsubscribeAll)).subscribe((agents: AgentContextApi[]) => {
			// Set loading false when data arrives or initial state (null) is confirmed
			this.isLoading = false;

			// Mark for check
			this._changeDetectorRef.markForCheck();
		});

		// Subscribe to search input field value changes
		this.searchInputControl.valueChanges
			.pipe(
				takeUntil(this._unsubscribeAll),
				debounceTime(300),
				switchMap((query) => {
					this.isLoading = true;
					this._changeDetectorRef.markForCheck(); // Mark for check when starting load
					// Trigger the service call that will update agents$
					this.agentService.refreshAgents(); // Or potentially a search-specific method if available
					// Return the agents$ observable to let the stream continue, though the value isn't directly used here
					return this.agentService.agents$;
				}),
				// No map here, isLoading is handled by the main agents$ subscription
			)
			.subscribe();
	}

	/**
	 * After view init
	 */
	ngAfterViewInit(): void {
		if (this._sort && this._paginator) {
			// Set the initial sort
			this._sort.sort({
				id: 'name',
				start: 'asc',
				disableClear: true,
			});

			// Mark for check
			this._changeDetectorRef.markForCheck();

			// If the user changes the sort order...
			this._sort.sortChange.pipe(takeUntil(this._unsubscribeAll)).subscribe(() => {
				// Reset back to the first page
				// TODO: Add pagination controls back if needed
				// this._paginator.pageIndex = 0;

				// Trigger data fetch on sort change
				this.isLoading = true;
				this._changeDetectorRef.markForCheck();
				this.agentService.refreshAgents(); // Assuming sort is handled server-side or needs a refresh
			});

			// Get agents if page changes (if paginator is used)
			// merge(this._sort.sortChange, this._paginator.page) // Combine sort and page changes if paginator exists
			// For now, only handle sort change triggering refresh
			// If paginator is added back, merge its page event here.

			// Example if paginator were active:
			/*
            merge(this._sort.sortChange, this._paginator.page)
                .pipe(
                    takeUntil(this._unsubscribeAll),
                    switchMap(() => {
                        this.isLoading = true;
                        this._changeDetectorRef.markForCheck();
                        this._inventoryService.refreshAgents(); // Trigger refresh
                        return this._inventoryService.agents$; // Return observable
                    }),
                    // No map here, isLoading handled by main subscription
                )
                .subscribe();
            */
		}
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

	getStateClass(state: string): string {
		return `state-${state.toLowerCase()}`;
	}

	isAllSelected(): boolean {
		// const numSelected = this.selection.selected.length;
		// const numRows = this.agents.length; // Needs agents array directly if used
		// return numSelected === numRows && numRows > 0;
		return false; // Placeholder
	}

	masterToggle(): void {
		if (this.isAllSelected()) {
			this.selection.clear();
		} else {
			// this.agents.forEach(row => this.selection.select(row)); // Needs agents array
		}
	}

	deleteSelectedAgents(): void {
		const selectedAgentIds = this.selection.selected.map((agent) => agent.agentId);
		if (selectedAgentIds.length === 0) {
			// Consider adding FuseConfirmationService or similar feedback
			return;
		}

		// Example using FuseConfirmationService (already injected)
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
				this.isLoading = true;
				this._changeDetectorRef.markForCheck();
				this.agentService.deleteAgents(selectedAgentIds).subscribe({
					next: () => {
						// isLoading will be set to false by the agents$ subscription update
						this.selection.clear();
						// Optionally show success message
					},
					error: (error) => {
						console.error('Error deleting agents:', error);
						this.isLoading = false; // Ensure loading is false on error
						this._changeDetectorRef.markForCheck();
						// Optionally show error message
					},
				});
			}
		});
	}

	/**
	 * Triggers a refresh of the agent list.
	 */
	refreshAgents(): void {
		if (this.isLoading) {
			// Prevent multiple clicks while loading
			return;
		}
		this.isLoading = true;
		this._changeDetectorRef.markForCheck();
		this.agentService.refreshAgents(); // Trigger the refresh in the service
		// isLoading will be set to false by the agents$ subscription when data arrives
	}

	/**
	 * Create product - Placeholder/Example navigation
	 */
	createProduct(): void {
		console.log('TODO navigate to agent creation');
		// Example: this._router.navigate(['/ui/agents/new']);
	}

	/**
	 * Delete the selected product using the form data - Placeholder/Example
	 */
	deleteSelectedProduct(): void {
		// This seems like leftover code, deleteSelectedAgents handles agent deletion
		console.warn('deleteSelectedProduct called, but deleteSelectedAgents should be used for agents.');
	}

	/**
	 * Show flash message - Placeholder/Example
	 */
	showFlashMessage(type: 'success' | 'error'): void {
		// Consider using MatSnackBar or a dedicated notification service
		console.log(`Flash message: ${type}`);
		this.flashMessage = type;
		this._changeDetectorRef.markForCheck();
		setTimeout(() => {
			this.flashMessage = null;
			this._changeDetectorRef.markForCheck();
		}, 3000);
	}

	/**
	 * Track by function for ngFor loops
	 *
	 * @param index
	 * @param item
	 */
	trackByFn(index: number, item: AgentContextApi): string | number {
		return item.agentId || index; // Use agentId for tracking
	}
}
