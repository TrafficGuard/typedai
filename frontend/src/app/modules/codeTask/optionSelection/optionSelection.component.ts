import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Represents a parallel option being explored
 */
export interface ParallelOption {
	/** Unique option ID */
	id: string;
	/** Option name */
	name: string;
	/** Description */
	description: string;
	/** Pros of this option */
	pros: string[];
	/** Cons of this option */
	cons: string[];
	/** Current status */
	status: 'pending' | 'in_progress' | 'completed' | 'failed';
	/** Summary of implementation */
	summary?: string;
	/** Diff statistics */
	diffStats?: {
		filesChanged: number;
		insertions: number;
		deletions: number;
	};
	/** Commits made */
	commits?: string[];
	/** Cost incurred */
	cost?: number;
	/** Branch name */
	branch?: string;
}

/**
 * Event emitted when user selects an option
 */
export interface OptionSelectionEvent {
	selectedOptionId: string;
	cancelledOptionId: string;
}

/**
 * Component for selecting between parallel implementation options.
 * Shows both options side-by-side using MatTabs for comparison.
 */
@Component({
	selector: 'option-selection',
	templateUrl: './optionSelection.component.html',
	styleUrls: ['./optionSelection.component.scss'],
	encapsulation: ViewEncapsulation.None,
	standalone: true,
	imports: [
		CommonModule,
		MatCardModule,
		MatButtonModule,
		MatIconModule,
		MatTabsModule,
		MatChipsModule,
		MatDividerModule,
		MatProgressBarModule,
		MatTooltipModule,
	],
})
export class OptionSelectionComponent {
	/** The decision question */
	@Input() question: string = '';

	/** Available options */
	@Input() options: ParallelOption[] = [];

	/** Task ID */
	@Input() taskId: string = '';

	/** Whether selection is in progress */
	@Input() isSelecting: boolean = false;

	/** Emitted when user selects an option */
	@Output() optionSelected = new EventEmitter<OptionSelectionEvent>();

	/** Emitted when user cancels/skips */
	@Output() selectionCancelled = new EventEmitter<void>();

	selectedTabIndex = 0;

	/**
	 * Gets the status icon for an option
	 */
	getStatusIcon(status: ParallelOption['status']): string {
		switch (status) {
			case 'pending':
				return 'heroicons_outline:clock';
			case 'in_progress':
				return 'heroicons_outline:refresh';
			case 'completed':
				return 'heroicons_outline:check-circle';
			case 'failed':
				return 'heroicons_outline:x-circle';
			default:
				return 'heroicons_outline:question-mark-circle';
		}
	}

	/**
	 * Gets the status color for an option
	 */
	getStatusColor(status: ParallelOption['status']): string {
		switch (status) {
			case 'pending':
				return 'text-gray-500';
			case 'in_progress':
				return 'text-blue-500';
			case 'completed':
				return 'text-green-500';
			case 'failed':
				return 'text-red-500';
			default:
				return 'text-gray-400';
		}
	}

	/**
	 * Checks if both options are ready for selection
	 */
	get canSelect(): boolean {
		return (
			this.options.length >= 2 &&
			this.options.every((opt) => opt.status === 'completed' || opt.status === 'failed') &&
			this.options.some((opt) => opt.status === 'completed')
		);
	}

	/**
	 * Checks if any option is still in progress
	 */
	get isAnyInProgress(): boolean {
		return this.options.some((opt) => opt.status === 'in_progress' || opt.status === 'pending');
	}

	/**
	 * Formats diff stats for display
	 */
	formatDiffStats(option: ParallelOption): string {
		if (!option.diffStats) return 'No changes';
		const { filesChanged, insertions, deletions } = option.diffStats;
		return `${filesChanged} files changed, +${insertions}/-${deletions}`;
	}

	/**
	 * Formats cost for display
	 */
	formatCost(cost?: number): string {
		if (cost === undefined) return '-';
		return `$${cost.toFixed(4)}`;
	}

	/**
	 * Handles selection of an option
	 */
	selectOption(selectedOption: ParallelOption): void {
		if (!this.canSelect || this.isSelecting) return;

		const cancelledOption = this.options.find((opt) => opt.id !== selectedOption.id);
		if (!cancelledOption) return;

		this.optionSelected.emit({
			selectedOptionId: selectedOption.id,
			cancelledOptionId: cancelledOption.id,
		});
	}

	/**
	 * Handles cancellation
	 */
	cancel(): void {
		this.selectionCancelled.emit();
	}
}
