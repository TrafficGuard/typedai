import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';

export const AGENT_REQUEST_FEEDBACK = 'AgentFeedback_requestFeedback';

export const REQUEST_FEEDBACK_PARAM_NAME = 'request';

/**
 * Functions for the agent to request feedback
 */
@funcClass(__filename)
export class AgentFeedback {
	/**
	 * Request feedback/interaction from a supervisor when a decision or approval needs to be made, or additional details are required, before proceeding with the plan.
	 * Minimise calls to requestFeedback by attempting/verifying possible options first.
	 * @param {string} request Notes on what additional information/decision is required. Be specific on what you have been doing up to this point, and provide relevant information to help with the decision/feedback.
	 */
	@func()
	async requestFeedback(request: string): Promise<string> {
		// arg name must match REQUEST_FEEDBACK_PARAM_NAME
		logger.info(`Feedback requested: ${request}`);
		return ''; // This will be replaced by the supervisor feedback
	}
}
