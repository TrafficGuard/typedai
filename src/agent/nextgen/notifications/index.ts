/**
 * Notifications Module
 *
 * Exports for multi-channel notification dispatch.
 */

export {
	NotificationService,
	createNotificationService,
	getNotificationService,
	type NotificationServiceConfig,
	type Notification,
	type NotificationResult,
	type NotificationAction,
	type NotificationType,
	type NotificationPriority,
	type NotificationChannel,
	type ChannelResult,
	type CLIChannelConfig,
	type DesktopChannelConfig,
	type WebhookChannelConfig,
	type WebSocketChannelConfig,
} from './notificationService';
