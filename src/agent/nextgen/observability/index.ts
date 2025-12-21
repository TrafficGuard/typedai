/**
 * Observability Module
 *
 * Provides structured event logging and real-time monitoring for agent sessions.
 *
 * Key files:
 * - events.jsonl: All events in JSON Lines format (append-only)
 * - monitor.json: Current state snapshot for external tools
 */

// Event Log
export {
	EventLog,
	createEventLog,
	type AgentEvent,
	type AgentEventType,
	type EventFilter,
	type EventListener,
	type EventLogOptions,
	type LogOptions,
} from './eventLog';

// Monitor
export {
	AgentMonitor,
	createAgentMonitor,
	createConnectedMonitor,
	type AgentPhase,
	type CostState,
	type MonitorState,
	type ProgressState,
} from './monitor';
