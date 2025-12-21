/**
 * Notification Service
 *
 * Multi-channel notification dispatch for agent events.
 * Supports CLI, desktop, webhook, and WebSocket channels.
 */

import { logger } from '#o11y/logger';

// ============================================================================
// Notification Types
// ============================================================================

/**
 * Notification priority levels
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Types of notifications the agent can send
 */
export type NotificationType =
	| 'task_started'
	| 'task_completed'
	| 'task_failed'
	| 'milestone_completed'
	| 'subtask_completed'
	| 'subtask_merged'
	| 'subtask_failed'
	| 'decision_required'
	| 'parallel_options_ready'
	| 'review_required'
	| 'review_complete'
	| 'error'
	| 'warning'
	| 'info';

/**
 * A notification to be sent
 */
export interface Notification {
	/** Unique notification ID */
	id: string;
	/** Type of notification */
	type: NotificationType;
	/** Priority level */
	priority: NotificationPriority;
	/** Title/subject */
	title: string;
	/** Main message content */
	message: string;
	/** Additional data */
	data?: Record<string, unknown>;
	/** Task ID this relates to */
	taskId?: string;
	/** Subtask ID this relates to */
	subtaskId?: string;
	/** Timestamp */
	timestamp: number;
	/** Channels to send to (overrides defaults) */
	channels?: NotificationChannel[];
	/** Action buttons/links */
	actions?: NotificationAction[];
}

/**
 * Action that can be taken on a notification
 */
export interface NotificationAction {
	/** Action label */
	label: string;
	/** Action type */
	type: 'url' | 'callback' | 'api';
	/** URL for 'url' type */
	url?: string;
	/** API endpoint for 'api' type */
	endpoint?: string;
	/** HTTP method for 'api' type */
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
}

/**
 * Available notification channels
 */
export type NotificationChannel = 'cli' | 'desktop' | 'webhook' | 'websocket';

/**
 * Result of sending a notification
 */
export interface NotificationResult {
	/** Notification ID */
	notificationId: string;
	/** Results per channel */
	channelResults: Record<NotificationChannel, ChannelResult>;
	/** Overall success */
	success: boolean;
}

/**
 * Result from a single channel
 */
export interface ChannelResult {
	/** Whether the channel delivered successfully */
	success: boolean;
	/** Error message if failed */
	error?: string;
	/** Response data from channel */
	response?: unknown;
}

// ============================================================================
// Channel Configurations
// ============================================================================

/**
 * CLI channel configuration
 */
export interface CLIChannelConfig {
	enabled: boolean;
	/** Whether to use colors */
	useColors: boolean;
	/** Whether to use icons */
	useIcons: boolean;
}

/**
 * Desktop channel configuration
 */
export interface DesktopChannelConfig {
	enabled: boolean;
	/** Application name for notifications */
	appName: string;
	/** Sound to play */
	sound: boolean;
}

/**
 * Webhook channel configuration
 */
export interface WebhookChannelConfig {
	enabled: boolean;
	/** Webhook URL (Slack, Discord, etc.) */
	url: string;
	/** Custom headers */
	headers?: Record<string, string>;
	/** Webhook format */
	format: 'slack' | 'discord' | 'generic';
}

/**
 * WebSocket channel configuration
 */
export interface WebSocketChannelConfig {
	enabled: boolean;
	/** WebSocket server URL or broadcast function */
	broadcast?: (message: string) => void;
}

/**
 * Full notification service configuration
 */
export interface NotificationServiceConfig {
	/** CLI channel config */
	cli?: Partial<CLIChannelConfig>;
	/** Desktop channel config */
	desktop?: Partial<DesktopChannelConfig>;
	/** Webhook channel config */
	webhook?: Partial<WebhookChannelConfig>;
	/** WebSocket channel config */
	websocket?: Partial<WebSocketChannelConfig>;
	/** Default channels for each notification type */
	defaultChannels?: Partial<Record<NotificationType, NotificationChannel[]>>;
	/** Default channels for each priority */
	priorityChannels?: Partial<Record<NotificationPriority, NotificationChannel[]>>;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CLI_CONFIG: CLIChannelConfig = {
	enabled: true,
	useColors: true,
	useIcons: true,
};

const DEFAULT_DESKTOP_CONFIG: DesktopChannelConfig = {
	enabled: false,
	appName: 'TypedAI Agent',
	sound: true,
};

const DEFAULT_WEBHOOK_CONFIG: WebhookChannelConfig = {
	enabled: false,
	url: '',
	format: 'generic',
};

const DEFAULT_WEBSOCKET_CONFIG: WebSocketChannelConfig = {
	enabled: false,
};

const DEFAULT_PRIORITY_CHANNELS: Record<NotificationPriority, NotificationChannel[]> = {
	low: ['cli'],
	normal: ['cli', 'websocket'],
	high: ['cli', 'desktop', 'websocket'],
	urgent: ['cli', 'desktop', 'webhook', 'websocket'],
};

// ============================================================================
// Notification Service Implementation
// ============================================================================

/**
 * Service for sending notifications across multiple channels
 */
export class NotificationService {
	private config: {
		cli: CLIChannelConfig;
		desktop: DesktopChannelConfig;
		webhook: WebhookChannelConfig;
		websocket: WebSocketChannelConfig;
		defaultChannels: Partial<Record<NotificationType, NotificationChannel[]>>;
		priorityChannels: Record<NotificationPriority, NotificationChannel[]>;
	};
	private nextId = 1;
	private history: Notification[] = [];
	private maxHistory = 100;

	constructor(config: NotificationServiceConfig = {}) {
		this.config = {
			cli: { ...DEFAULT_CLI_CONFIG, ...config.cli },
			desktop: { ...DEFAULT_DESKTOP_CONFIG, ...config.desktop },
			webhook: { ...DEFAULT_WEBHOOK_CONFIG, ...config.webhook },
			websocket: { ...DEFAULT_WEBSOCKET_CONFIG, ...config.websocket },
			defaultChannels: config.defaultChannels ?? {},
			priorityChannels: { ...DEFAULT_PRIORITY_CHANNELS, ...config.priorityChannels },
		};
	}

	/**
	 * Sends a notification
	 */
	async send(notification: Omit<Notification, 'id' | 'timestamp'>): Promise<NotificationResult> {
		const fullNotification: Notification = {
			...notification,
			id: `notif-${this.nextId++}`,
			timestamp: Date.now(),
		};

		// Add to history
		this.history.push(fullNotification);
		if (this.history.length > this.maxHistory) {
			this.history.shift();
		}

		// Determine channels
		const channels = this.getChannels(fullNotification);

		// Send to each channel
		const channelResults: Record<NotificationChannel, ChannelResult> = {
			cli: { success: false },
			desktop: { success: false },
			webhook: { success: false },
			websocket: { success: false },
		};

		const promises: Promise<void>[] = [];

		if (channels.includes('cli')) {
			promises.push(
				this.sendCLI(fullNotification).then((r) => {
					channelResults.cli = r;
				}),
			);
		}
		if (channels.includes('desktop')) {
			promises.push(
				this.sendDesktop(fullNotification).then((r) => {
					channelResults.desktop = r;
				}),
			);
		}
		if (channels.includes('webhook')) {
			promises.push(
				this.sendWebhook(fullNotification).then((r) => {
					channelResults.webhook = r;
				}),
			);
		}
		if (channels.includes('websocket')) {
			promises.push(
				this.sendWebSocket(fullNotification).then((r) => {
					channelResults.websocket = r;
				}),
			);
		}

		await Promise.all(promises);

		const success = channels.some((ch) => channelResults[ch].success);

		logger.debug({ notificationId: fullNotification.id, type: fullNotification.type, channels, success }, 'Notification sent');

		return {
			notificationId: fullNotification.id,
			channelResults,
			success,
		};
	}

	/**
	 * Sends a simple notification
	 */
	async notify(type: NotificationType, title: string, message: string, options?: Partial<Notification>): Promise<NotificationResult> {
		return this.send({
			type,
			title,
			message,
			priority: this.getPriorityForType(type),
			...options,
		});
	}

	/**
	 * Sends an urgent notification
	 */
	async urgent(title: string, message: string, options?: Partial<Notification>): Promise<NotificationResult> {
		return this.send({
			type: 'decision_required',
			title,
			message,
			priority: 'urgent',
			...options,
		});
	}

	/**
	 * Notifies that parallel options are ready for selection
	 */
	async notifyParallelOptionsReady(taskId: string, options: Array<{ id: string; name: string; summary: string }>): Promise<NotificationResult> {
		const optionsList = options.map((o) => `  - ${o.name}: ${o.summary}`).join('\n');
		return this.send({
			type: 'parallel_options_ready',
			title: 'Parallel Options Ready for Selection',
			message: `Both options have been implemented:\n${optionsList}\n\nPlease select which option to keep.`,
			priority: 'high',
			taskId,
			data: { options },
			actions: options.map((o) => ({
				label: `Select ${o.name}`,
				type: 'api' as const,
				endpoint: `/api/tasks/${taskId}/select-option/${o.id}`,
				method: 'POST' as const,
			})),
		});
	}

	/**
	 * Notifies that a decision is required
	 */
	async notifyDecisionRequired(taskId: string, question: string, options: string[]): Promise<NotificationResult> {
		return this.send({
			type: 'decision_required',
			title: 'Decision Required',
			message: `${question}\n\nOptions:\n${options.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}`,
			priority: 'urgent',
			taskId,
			data: { question, options },
		});
	}

	/**
	 * Notifies that review is required
	 */
	async notifyReviewRequired(taskId: string, subtaskId: string, summary: string): Promise<NotificationResult> {
		return this.send({
			type: 'review_required',
			title: 'Review Required',
			message: summary,
			priority: 'high',
			taskId,
			subtaskId,
			actions: [
				{
					label: 'Approve',
					type: 'api',
					endpoint: `/api/tasks/${taskId}/subtasks/${subtaskId}/approve`,
					method: 'POST',
				},
				{
					label: 'Request Changes',
					type: 'api',
					endpoint: `/api/tasks/${taskId}/subtasks/${subtaskId}/request-changes`,
					method: 'POST',
				},
			],
		});
	}

	/**
	 * Gets notification history
	 */
	getHistory(limit?: number): Notification[] {
		const history = [...this.history].reverse();
		return limit ? history.slice(0, limit) : history;
	}

	/**
	 * Updates channel configuration
	 */
	updateConfig(config: Partial<NotificationServiceConfig>): void {
		if (config.cli) Object.assign(this.config.cli, config.cli);
		if (config.desktop) Object.assign(this.config.desktop, config.desktop);
		if (config.webhook) Object.assign(this.config.webhook, config.webhook);
		if (config.websocket) Object.assign(this.config.websocket, config.websocket);
		if (config.defaultChannels) Object.assign(this.config.defaultChannels, config.defaultChannels);
		if (config.priorityChannels) Object.assign(this.config.priorityChannels, config.priorityChannels);
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Gets channels for a notification
	 */
	private getChannels(notification: Notification): NotificationChannel[] {
		// Explicit channels take precedence
		if (notification.channels && notification.channels.length > 0) {
			return notification.channels.filter((ch) => this.isChannelEnabled(ch));
		}

		// Then type-specific defaults
		const typeChannels = this.config.defaultChannels[notification.type];
		if (typeChannels && typeChannels.length > 0) {
			return typeChannels.filter((ch) => this.isChannelEnabled(ch));
		}

		// Finally priority-based defaults
		return this.config.priorityChannels[notification.priority].filter((ch) => this.isChannelEnabled(ch));
	}

	/**
	 * Checks if a channel is enabled
	 */
	private isChannelEnabled(channel: NotificationChannel): boolean {
		switch (channel) {
			case 'cli':
				return this.config.cli.enabled;
			case 'desktop':
				return this.config.desktop.enabled;
			case 'webhook':
				return this.config.webhook.enabled && !!this.config.webhook.url;
			case 'websocket':
				return this.config.websocket.enabled;
			default:
				return false;
		}
	}

	/**
	 * Gets default priority for notification type
	 */
	private getPriorityForType(type: NotificationType): NotificationPriority {
		switch (type) {
			case 'decision_required':
			case 'parallel_options_ready':
				return 'urgent';
			case 'task_failed':
			case 'subtask_failed':
			case 'error':
				return 'high';
			case 'review_required':
			case 'warning':
				return 'high';
			case 'task_completed':
			case 'milestone_completed':
			case 'review_complete':
				return 'normal';
			default:
				return 'low';
		}
	}

	/**
	 * Sends notification to CLI
	 */
	private async sendCLI(notification: Notification): Promise<ChannelResult> {
		try {
			const { useColors, useIcons } = this.config.cli;
			const icon = useIcons ? this.getIcon(notification.type) : '';
			const colorFn = useColors ? this.getColorFn(notification.priority) : (s: string) => s;

			const output = colorFn(`${icon} [${notification.type.toUpperCase()}] ${notification.title}\n${notification.message}`);
			console.log(output);

			return { success: true };
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	/**
	 * Sends notification to desktop
	 */
	private async sendDesktop(notification: Notification): Promise<ChannelResult> {
		try {
			// Dynamic import to avoid requiring node-notifier if not used
			// @ts-expect-error node-notifier is an optional dependency
			const notifier = await import('node-notifier').catch(() => null);
			if (!notifier) {
				return { success: false, error: 'node-notifier not available' };
			}

			return new Promise((resolve) => {
				notifier.default.notify(
					{
						title: notification.title,
						message: notification.message,
						sound: this.config.desktop.sound,
						appID: this.config.desktop.appName,
					},
					(err) => {
						if (err) {
							resolve({ success: false, error: err.message });
						} else {
							resolve({ success: true });
						}
					},
				);
			});
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	/**
	 * Sends notification to webhook
	 */
	private async sendWebhook(notification: Notification): Promise<ChannelResult> {
		try {
			const { url, headers, format } = this.config.webhook;
			if (!url) {
				return { success: false, error: 'Webhook URL not configured' };
			}

			const body = this.formatWebhookBody(notification, format);

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...headers,
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				return {
					success: false,
					error: `Webhook returned ${response.status}: ${response.statusText}`,
				};
			}

			return { success: true, response: await response.json().catch(() => null) };
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	/**
	 * Sends notification via WebSocket
	 */
	private async sendWebSocket(notification: Notification): Promise<ChannelResult> {
		try {
			const { broadcast } = this.config.websocket;
			if (!broadcast) {
				return { success: false, error: 'WebSocket broadcast function not configured' };
			}

			const message = JSON.stringify({
				type: 'notification',
				notification,
			});

			broadcast(message);
			return { success: true };
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	/**
	 * Formats webhook body based on format
	 */
	private formatWebhookBody(notification: Notification, format: 'slack' | 'discord' | 'generic'): unknown {
		switch (format) {
			case 'slack':
				return {
					text: `*${notification.title}*\n${notification.message}`,
					attachments: notification.actions?.map((action) => ({
						text: action.label,
						callback_id: action.endpoint,
					})),
				};

			case 'discord':
				return {
					content: `**${notification.title}**\n${notification.message}`,
					embeds: notification.data
						? [
								{
									title: notification.type,
									fields: Object.entries(notification.data).map(([k, v]) => ({
										name: k,
										value: String(v),
										inline: true,
									})),
								},
							]
						: undefined,
				};

			default:
				return {
					id: notification.id,
					type: notification.type,
					priority: notification.priority,
					title: notification.title,
					message: notification.message,
					data: notification.data,
					timestamp: notification.timestamp,
					actions: notification.actions,
				};
		}
	}

	/**
	 * Gets icon for notification type
	 */
	private getIcon(type: NotificationType): string {
		const icons: Record<NotificationType, string> = {
			task_started: '🚀',
			task_completed: '✅',
			task_failed: '❌',
			milestone_completed: '🏁',
			subtask_completed: '✓',
			subtask_merged: '🔀',
			subtask_failed: '✗',
			decision_required: '❓',
			parallel_options_ready: '🔀',
			review_required: '👀',
			review_complete: '✔️',
			error: '🔴',
			warning: '⚠️',
			info: 'ℹ️',
		};
		return icons[type] || '📢';
	}

	/**
	 * Gets color function for priority
	 */
	private getColorFn(priority: NotificationPriority): (s: string) => string {
		// ANSI color codes
		const colors: Record<NotificationPriority, string> = {
			low: '\x1b[90m', // gray
			normal: '\x1b[0m', // default
			high: '\x1b[33m', // yellow
			urgent: '\x1b[31m', // red
		};
		const reset = '\x1b[0m';
		return (s: string) => `${colors[priority]}${s}${reset}`;
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a notification service
 */
export function createNotificationService(config?: NotificationServiceConfig): NotificationService {
	return new NotificationService(config);
}

// ============================================================================
// Singleton Instance (optional)
// ============================================================================

let defaultInstance: NotificationService | null = null;

/**
 * Gets or creates the default notification service instance
 */
export function getNotificationService(config?: NotificationServiceConfig): NotificationService {
	if (!defaultInstance) {
		defaultInstance = new NotificationService(config);
	} else if (config) {
		defaultInstance.updateConfig(config);
	}
	return defaultInstance;
}
