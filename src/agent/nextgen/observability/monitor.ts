/**
 * Real-Time Agent Monitor
 *
 * Maintains a snapshot of the current agent state for real-time monitoring.
 * The state is persisted to monitor.json for external tools to read.
 *
 * Key features:
 * - Real-time state updates
 * - Automatic persistence on state changes
 * - Cost tracking
 * - Progress tracking
 * - Error collection
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentEvent, EventLog } from './eventLog';

// =============================================================================
// Monitor State Types
// =============================================================================

export type AgentPhase = 'initializing' | 'working' | 'reviewing' | 'parallel' | 'blocked' | 'complete' | 'idle';

export interface ProgressState {
	completed: number;
	total: number;
	failing: number;
	blocked: number;
}

export interface CostState {
	total: number;
	lastHour: number;
	breakdown: {
		planning: number;
		implementation: number;
		review: number;
		parallel: number;
	};
}

export interface MonitorState {
	/** Task ID being monitored */
	taskId: string;
	/** When monitoring started */
	startedAt: string;
	/** Current phase of the agent */
	currentPhase: AgentPhase;
	/** Current feature being worked on */
	currentFeatureId?: string;
	/** Current feature description */
	currentFeatureDescription?: string;
	/** Progress summary */
	progress: ProgressState;
	/** Cost tracking */
	cost: CostState;
	/** Most recent events */
	recentEvents: AgentEvent[];
	/** All error events */
	errors: AgentEvent[];
	/** Last updated timestamp */
	lastUpdated: string;
	/** Whether the agent is actively working */
	isActive: boolean;
}

// =============================================================================
// Agent Monitor Class
// =============================================================================

/**
 * Real-time agent monitor with persistence.
 */
export class AgentMonitor {
	private state: MonitorState;
	private persistPath: string;
	private eventLog?: EventLog;
	private unsubscribe?: () => void;
	private persistTimer?: ReturnType<typeof setTimeout>;
	private persistDebounceMs = 500; // Debounce persistence

	constructor(taskId: string, workingDir: string) {
		this.persistPath = path.join(workingDir, '.typedai', 'memory', taskId, 'monitor.json');
		this.state = this.createInitialState(taskId);
	}

	// ===========================================================================
	// State Management
	// ===========================================================================

	/**
	 * Create initial monitor state.
	 */
	private createInitialState(taskId: string): MonitorState {
		return {
			taskId,
			startedAt: new Date().toISOString(),
			currentPhase: 'initializing',
			progress: {
				completed: 0,
				total: 0,
				failing: 0,
				blocked: 0,
			},
			cost: {
				total: 0,
				lastHour: 0,
				breakdown: {
					planning: 0,
					implementation: 0,
					review: 0,
					parallel: 0,
				},
			},
			recentEvents: [],
			errors: [],
			lastUpdated: new Date().toISOString(),
			isActive: true,
		};
	}

	/**
	 * Get current state.
	 */
	getState(): MonitorState {
		return { ...this.state };
	}

	/**
	 * Update state and persist.
	 */
	private updateState(updates: Partial<MonitorState>): void {
		this.state = {
			...this.state,
			...updates,
			lastUpdated: new Date().toISOString(),
		};
		this.schedulePersist();
	}

	// ===========================================================================
	// Phase Updates
	// ===========================================================================

	/**
	 * Set the current phase.
	 */
	setPhase(phase: AgentPhase): void {
		this.updateState({ currentPhase: phase });
	}

	/**
	 * Set the current feature being worked on.
	 */
	setCurrentFeature(featureId: string, description: string): void {
		this.updateState({
			currentFeatureId: featureId,
			currentFeatureDescription: description,
		});
	}

	/**
	 * Clear the current feature.
	 */
	clearCurrentFeature(): void {
		this.updateState({
			currentFeatureId: undefined,
			currentFeatureDescription: undefined,
		});
	}

	// ===========================================================================
	// Progress Updates
	// ===========================================================================

	/**
	 * Update progress counts.
	 */
	setProgress(progress: ProgressState): void {
		this.updateState({ progress });
	}

	/**
	 * Increment completed count.
	 */
	incrementCompleted(): void {
		this.updateState({
			progress: {
				...this.state.progress,
				completed: this.state.progress.completed + 1,
			},
		});
	}

	/**
	 * Increment failing count.
	 */
	incrementFailing(): void {
		this.updateState({
			progress: {
				...this.state.progress,
				failing: this.state.progress.failing + 1,
			},
		});
	}

	// ===========================================================================
	// Cost Tracking
	// ===========================================================================

	/**
	 * Add cost to the total and breakdown.
	 */
	addCost(amount: number, category: keyof CostState['breakdown']): void {
		const cost = { ...this.state.cost };
		cost.total += amount;
		cost.breakdown[category] += amount;

		// Update lastHour cost (simplified - just tracks recent)
		cost.lastHour += amount;

		this.updateState({ cost });
	}

	/**
	 * Set the total cost.
	 */
	setTotalCost(total: number): void {
		this.updateState({
			cost: {
				...this.state.cost,
				total,
			},
		});
	}

	// ===========================================================================
	// Event Integration
	// ===========================================================================

	/**
	 * Connect to an event log for automatic updates.
	 */
	connectEventLog(eventLog: EventLog): void {
		this.eventLog = eventLog;
		this.unsubscribe = eventLog.subscribe((event) => this.handleEvent(event));
	}

	/**
	 * Disconnect from the event log.
	 */
	disconnectEventLog(): void {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
		this.eventLog = undefined;
	}

	/**
	 * Handle an incoming event.
	 */
	private handleEvent(event: AgentEvent): void {
		// Add to recent events (keep last 20)
		const recentEvents = [...this.state.recentEvents, event].slice(-20);

		// Collect errors
		let errors = this.state.errors;
		if (event.type === 'error') {
			errors = [...errors, event];
		}

		// Update phase based on event
		let phase = this.state.currentPhase;
		let featureId = this.state.currentFeatureId;
		let featureDescription = this.state.currentFeatureDescription;

		switch (event.type) {
			case 'session_start':
				phase = 'initializing';
				break;
			case 'feature_start':
				phase = 'working';
				featureId = event.featureId;
				featureDescription = event.data.description as string;
				break;
			case 'feature_complete':
				this.incrementCompleted();
				featureId = undefined;
				featureDescription = undefined;
				break;
			case 'feature_failed':
				this.incrementFailing();
				break;
			case 'review_start':
				phase = 'reviewing';
				break;
			case 'review_decision':
				phase = 'working';
				break;
			case 'parallel_start':
				phase = 'parallel';
				break;
			case 'parallel_complete':
				phase = 'working';
				break;
			case 'session_end':
				phase = 'complete';
				this.updateState({ isActive: false });
				break;
		}

		this.updateState({
			recentEvents,
			errors,
			currentPhase: phase,
			currentFeatureId: featureId,
			currentFeatureDescription: featureDescription,
		});
	}

	// ===========================================================================
	// Persistence
	// ===========================================================================

	/**
	 * Schedule persistence (debounced).
	 */
	private schedulePersist(): void {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
		}
		this.persistTimer = setTimeout(() => {
			this.persist().catch(() => {
				// Ignore persistence errors
			});
		}, this.persistDebounceMs);
	}

	/**
	 * Persist current state to file.
	 */
	async persist(): Promise<void> {
		await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
		await fs.writeFile(this.persistPath, JSON.stringify(this.state, null, 2), 'utf-8');
	}

	/**
	 * Load state from file.
	 */
	async load(): Promise<MonitorState | null> {
		try {
			const content = await fs.readFile(this.persistPath, 'utf-8');
			this.state = JSON.parse(content) as MonitorState;
			return this.state;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw error;
		}
	}

	// ===========================================================================
	// Cleanup
	// ===========================================================================

	/**
	 * Stop monitoring and cleanup.
	 */
	async stop(): Promise<void> {
		this.disconnectEventLog();
		this.updateState({ isActive: false });

		// Clear debounce timer and persist immediately
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
		}
		await this.persist();
	}
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a monitor for a task.
 */
export function createAgentMonitor(taskId: string, workingDir: string): AgentMonitor {
	return new AgentMonitor(taskId, workingDir);
}

/**
 * Create a monitor connected to an event log.
 */
export function createConnectedMonitor(taskId: string, workingDir: string, eventLog: EventLog): AgentMonitor {
	const monitor = createAgentMonitor(taskId, workingDir);
	monitor.connectEventLog(eventLog);
	return monitor;
}
