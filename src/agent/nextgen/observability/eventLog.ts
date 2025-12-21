/**
 * Structured Event Logging
 *
 * Provides structured event logging for agent sessions.
 * Events are stored in events.jsonl (JSON Lines format) for post-mortem debugging.
 *
 * Key features:
 * - Type-safe event definitions
 * - Event filtering and querying
 * - Subscriber pattern for real-time notifications
 * - Persistence to events.jsonl
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// =============================================================================
// Event Types
// =============================================================================

export type AgentEventType =
	| 'session_start'
	| 'session_end'
	| 'feature_start'
	| 'feature_complete'
	| 'feature_failed'
	| 'test_run'
	| 'review_start'
	| 'review_decision'
	| 'parallel_start'
	| 'parallel_complete'
	| 'error'
	| 'checkpoint_save'
	| 'checkpoint_restore'
	| 'human_intervention'
	| 'decision_made'
	| 'cost_update';

export interface AgentEvent {
	/** ISO timestamp when event occurred */
	timestamp: string;
	/** Type of event */
	type: AgentEventType;
	/** Task ID this event belongs to */
	taskId: string;
	/** Feature ID if applicable */
	featureId?: string;
	/** Milestone ID if applicable */
	milestoneId?: string;
	/** Event-specific data */
	data: Record<string, unknown>;
	/** Span ID for tracing (optional) */
	spanId?: string;
	/** Trace ID for distributed tracing (optional) */
	traceId?: string;
}

export type EventFilter = Partial<Pick<AgentEvent, 'type' | 'taskId' | 'featureId' | 'milestoneId'>>;

export type EventListener = (event: AgentEvent) => void;

// =============================================================================
// Event Log Class
// =============================================================================

/**
 * In-memory event log with persistence support.
 */
export class EventLog {
	private events: AgentEvent[] = [];
	private listeners: Map<string, EventListener> = new Map();
	private persistPath?: string;

	constructor(options: EventLogOptions = {}) {
		if (options.persistPath) {
			this.persistPath = options.persistPath;
		}
	}

	// ===========================================================================
	// Logging
	// ===========================================================================

	/**
	 * Log a new event.
	 */
	log(type: AgentEventType, taskId: string, data: Record<string, unknown>, options: LogOptions = {}): AgentEvent {
		const event: AgentEvent = {
			timestamp: new Date().toISOString(),
			type,
			taskId,
			data,
			featureId: options.featureId,
			milestoneId: options.milestoneId,
			spanId: options.spanId,
			traceId: options.traceId,
		};

		this.events.push(event);
		this.notifyListeners(event);

		// Persist asynchronously (fire and forget)
		if (this.persistPath) {
			this.persistEvent(event).catch(() => {
				// Ignore persistence errors
			});
		}

		return event;
	}

	/**
	 * Log a session start event.
	 */
	logSessionStart(taskId: string, data: { description: string }): AgentEvent {
		return this.log('session_start', taskId, data);
	}

	/**
	 * Log a session end event.
	 */
	logSessionEnd(taskId: string, data: { reason: string; cost?: number }): AgentEvent {
		return this.log('session_end', taskId, data);
	}

	/**
	 * Log a feature start event.
	 */
	logFeatureStart(taskId: string, featureId: string, data: { description: string; attempt: number }): AgentEvent {
		return this.log('feature_start', taskId, data, { featureId });
	}

	/**
	 * Log a feature complete event.
	 */
	logFeatureComplete(taskId: string, featureId: string, data: { filesChanged: string[]; commits: string[] }): AgentEvent {
		return this.log('feature_complete', taskId, data, { featureId });
	}

	/**
	 * Log a feature failed event.
	 */
	logFeatureFailed(taskId: string, featureId: string, data: { error: string; attempt: number }): AgentEvent {
		return this.log('feature_failed', taskId, data, { featureId });
	}

	/**
	 * Log a test run event.
	 */
	logTestRun(taskId: string, featureId: string, data: { passed: boolean; duration: number; output?: string }): AgentEvent {
		return this.log('test_run', taskId, data, { featureId });
	}

	/**
	 * Log a review start event.
	 */
	logReviewStart(taskId: string, featureId: string, data: { attempt: number }): AgentEvent {
		return this.log('review_start', taskId, data, { featureId });
	}

	/**
	 * Log a review decision event.
	 */
	logReviewDecision(taskId: string, featureId: string, data: { decision: string; confidence: number; feedback?: string }): AgentEvent {
		return this.log('review_decision', taskId, data, { featureId });
	}

	/**
	 * Log a parallel exploration start event.
	 */
	logParallelStart(taskId: string, featureId: string, data: { approaches: string[] }): AgentEvent {
		return this.log('parallel_start', taskId, data, { featureId });
	}

	/**
	 * Log a parallel exploration complete event.
	 */
	logParallelComplete(taskId: string, featureId: string, data: { selectedApproach: string; reason: string }): AgentEvent {
		return this.log('parallel_complete', taskId, data, { featureId });
	}

	/**
	 * Log an error event.
	 */
	logError(taskId: string, data: { error: string; stack?: string }, options: { featureId?: string } = {}): AgentEvent {
		return this.log('error', taskId, data, options);
	}

	/**
	 * Log a checkpoint save event.
	 */
	logCheckpointSave(taskId: string, data: { checkpointId: string; featureId?: string }): AgentEvent {
		return this.log('checkpoint_save', taskId, data, { featureId: data.featureId });
	}

	/**
	 * Log a checkpoint restore event.
	 */
	logCheckpointRestore(taskId: string, data: { checkpointId: string; phase: string }): AgentEvent {
		return this.log('checkpoint_restore', taskId, data);
	}

	// ===========================================================================
	// Querying
	// ===========================================================================

	/**
	 * Get all events matching the filter.
	 */
	getEvents(filter: EventFilter = {}): AgentEvent[] {
		return this.events.filter((event) => {
			if (filter.type && event.type !== filter.type) return false;
			if (filter.taskId && event.taskId !== filter.taskId) return false;
			if (filter.featureId && event.featureId !== filter.featureId) return false;
			if (filter.milestoneId && event.milestoneId !== filter.milestoneId) return false;
			return true;
		});
	}

	/**
	 * Get the most recent N events.
	 */
	getRecentEvents(count = 20): AgentEvent[] {
		return this.events.slice(-count);
	}

	/**
	 * Get all error events.
	 */
	getErrors(): AgentEvent[] {
		return this.getEvents({ type: 'error' });
	}

	/**
	 * Get events for a specific feature.
	 */
	getFeatureEvents(featureId: string): AgentEvent[] {
		return this.getEvents({ featureId });
	}

	/**
	 * Get all events as JSON string.
	 */
	toJSON(): string {
		return JSON.stringify(this.events, null, 2);
	}

	/**
	 * Get events in JSON Lines format.
	 */
	toJSONLines(): string {
		return this.events.map((e) => JSON.stringify(e)).join('\n');
	}

	// ===========================================================================
	// Subscribers
	// ===========================================================================

	/**
	 * Subscribe to events.
	 * Returns an unsubscribe function.
	 */
	subscribe(listener: EventListener): () => void {
		const id = crypto.randomUUID();
		this.listeners.set(id, listener);
		return () => {
			this.listeners.delete(id);
		};
	}

	/**
	 * Subscribe to specific event types.
	 */
	subscribeToType(type: AgentEventType, listener: EventListener): () => void {
		return this.subscribe((event) => {
			if (event.type === type) {
				listener(event);
			}
		});
	}

	private notifyListeners(event: AgentEvent): void {
		for (const listener of this.listeners.values()) {
			try {
				listener(event);
			} catch (error) {
				// Ignore listener errors
			}
		}
	}

	// ===========================================================================
	// Persistence
	// ===========================================================================

	private async persistEvent(event: AgentEvent): Promise<void> {
		if (!this.persistPath) return;

		const line = `${JSON.stringify(event)}\n`;
		await fs.appendFile(this.persistPath, line, 'utf-8');
	}

	/**
	 * Load events from a JSON Lines file.
	 */
	async loadFromFile(filePath: string): Promise<void> {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			const lines = content.split('\n').filter((l) => l.trim());
			for (const line of lines) {
				try {
					const event = JSON.parse(line) as AgentEvent;
					this.events.push(event);
				} catch {
					// Skip invalid lines
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
			// File doesn't exist, start fresh
		}
	}

	/**
	 * Save all events to a JSON Lines file.
	 */
	async saveToFile(filePath: string): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, this.toJSONLines(), 'utf-8');
	}

	/**
	 * Clear all events.
	 */
	clear(): void {
		this.events = [];
	}
}

// =============================================================================
// Types
// =============================================================================

export interface EventLogOptions {
	/** Path to persist events (events.jsonl) */
	persistPath?: string;
}

export interface LogOptions {
	featureId?: string;
	milestoneId?: string;
	spanId?: string;
	traceId?: string;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an event log for a task.
 */
export function createEventLog(workingDir: string, taskId: string): EventLog {
	const persistPath = path.join(workingDir, '.typedai', 'memory', taskId, 'events.jsonl');
	return new EventLog({ persistPath });
}
