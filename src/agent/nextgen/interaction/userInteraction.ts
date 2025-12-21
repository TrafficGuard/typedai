/**
 * User Interaction Provider
 *
 * Abstraction for user interaction that supports both CLI and Web interfaces.
 * The CLI uses terminal readline, the Web uses HTTP notifications with links.
 */

// ============================================================================
// Approval Types
// ============================================================================

/**
 * A request for user approval with options
 */
export interface ApprovalRequest {
	/** Unique identifier for this approval request */
	id: string;
	/** Title displayed to the user */
	title: string;
	/** Brief summary of what needs approval */
	summary: string;
	/** Full details to review (plan, diff, etc.) */
	details?: string;
	/** Link to view details (for web) */
	detailsUrl?: string;
	/** Available options to choose from */
	options: ApprovalOption[];
}

/**
 * An option for approval
 */
export interface ApprovalOption {
	/** Unique identifier */
	id: string;
	/** Display label */
	label: string;
	/** Description of what this option does */
	description?: string;
	/** Whether this is the default/recommended option */
	isDefault?: boolean;
}

/**
 * Response from user approval
 */
export interface ApprovalResponse {
	/** Selected option ID */
	optionId: string;
	/** Optional feedback text */
	feedback?: string;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Abstraction for user interaction.
 *
 * Implementations:
 * - CliInteractionProvider: Terminal readline input
 * - WebInteractionProvider: HTTP notifications with approval links
 */
export interface UserInteractionProvider {
	/**
	 * Request approval from the user with options.
	 * Blocks until user responds.
	 */
	requestApproval(request: ApprovalRequest): Promise<ApprovalResponse>;

	/**
	 * Send a notification to the user (non-blocking).
	 */
	notify(title: string, message: string, priority?: 'low' | 'normal' | 'high'): Promise<void>;

	/**
	 * Clean up resources (close readline, etc.)
	 */
	close(): void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Standard approval options for plan confirmation
 */
export function createPlanApprovalOptions(): ApprovalOption[] {
	return [
		{ id: 'approve', label: 'Proceed', description: 'Start executing the plan', isDefault: true },
		{ id: 'abort', label: 'Abort', description: 'Cancel and exit' },
	];
}

/**
 * Standard approval options for subtask review
 */
export function createSubtaskReviewOptions(): ApprovalOption[] {
	return [
		{ id: 'continue', label: 'Continue', description: 'Proceed to next subtask', isDefault: true },
		{ id: 'abort', label: 'Abort', description: 'Stop execution' },
	];
}

/**
 * Standard approval options for decision points
 */
export function createDecisionOptions(options: string[]): ApprovalOption[] {
	return options.map((opt, i) => ({
		id: `option-${i}`,
		label: opt,
		isDefault: i === 0,
	}));
}
