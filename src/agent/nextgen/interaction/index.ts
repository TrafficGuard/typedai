/**
 * NextGen Agent User Interaction
 *
 * Abstraction for user interaction supporting CLI and Web interfaces.
 */

export {
	type ApprovalOption,
	type ApprovalRequest,
	type ApprovalResponse,
	type UserInteractionProvider,
	createDecisionOptions,
	createPlanApprovalOptions,
	createSubtaskReviewOptions,
} from './userInteraction';

export { CliInteractionProvider } from './cliInteraction';
