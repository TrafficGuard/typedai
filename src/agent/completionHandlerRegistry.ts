import { ConsoleCompletedHandler } from '#agent/agentCompletion';
import { AgentCompleted } from '#agent/agentContextTypes';
import { SlackChatBotService } from '#modules/slack/slackChatBotService';
import { logger } from '#o11y/logger';

// Use a Map for easier addition/removal during tests
let handlersMap = new Map<string, new () => AgentCompleted>();

// Initialize with default handlers
handlersMap.set(new ConsoleCompletedHandler().agentCompletedHandlerId(), ConsoleCompletedHandler);
handlersMap.set(new SlackChatBotService().agentCompletedHandlerId(), SlackChatBotService);

/**
 * Return the AgentCompleted callback object from its id.
 * @param handlerId The ID of the handler to retrieve.
 * @returns The corresponding AgentCompleted handler instance, or null if the handlerId is falsy or not found.
 */
export function getCompletedHandler(handlerId: string): AgentCompleted | null {
	if (!handlerId) return null;

	const HandlerCtor = handlersMap.get(handlerId);
	if (HandlerCtor) {
		return new HandlerCtor();
	}

	logger.error(`No AgentCompleted handler found for id ${handlerId}`);
	return null;
}

/**
 * Registers a new AgentCompleted handler. Used primarily for testing.
 * @param handler An instance of the handler to register.
 */
export function registerCompletedHandler(handler: AgentCompleted): void {
	const handlerId = handler.agentCompletedHandlerId();
	const HandlerCtor = Object.getPrototypeOf(handler).constructor;
	if (handlersMap.has(handlerId)) {
		logger.warn(`Handler with ID '${handlerId}' already registered. Overwriting.`);
	}
	handlersMap.set(handlerId, HandlerCtor);
}

/**
 * Clears all registered handlers except the defaults. Used primarily for testing.
 */
export function clearCompletedHandlers(): void {
	handlersMap = new Map<string, new () => AgentCompleted>();
	// Re-initialize with default handlers
	handlersMap.set(new ConsoleCompletedHandler().agentCompletedHandlerId(), ConsoleCompletedHandler);
	handlersMap.set(new SlackChatBotService().agentCompletedHandlerId(), SlackChatBotService);
}
