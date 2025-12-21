/**
 * Unit Tests for observability module
 *
 * Tests for EventLog and AgentMonitor.
 */

import { expect } from 'chai';
import { type AgentEvent, type AgentEventType, EventLog } from '../../observability/eventLog';
import { AgentMonitor } from '../../observability/monitor';

describe('observability/eventLog', () => {
	// =============================================================================
	// EventLog Tests
	// =============================================================================

	describe('EventLog', () => {
		let eventLog: EventLog;

		beforeEach(() => {
			eventLog = new EventLog();
		});

		describe('log', () => {
			it('creates an event with correct fields', () => {
				const event = eventLog.log('session_start', 'task-1', { description: 'Test' });

				expect(event.type).to.equal('session_start');
				expect(event.taskId).to.equal('task-1');
				expect(event.data.description).to.equal('Test');
				expect(event.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T/);
			});

			it('includes optional fields when provided', () => {
				const event = eventLog.log(
					'feature_start',
					'task-1',
					{ attempt: 1 },
					{
						featureId: 'ft-1',
						milestoneId: 'ms-1',
						spanId: 'span-1',
						traceId: 'trace-1',
					},
				);

				expect(event.featureId).to.equal('ft-1');
				expect(event.milestoneId).to.equal('ms-1');
				expect(event.spanId).to.equal('span-1');
				expect(event.traceId).to.equal('trace-1');
			});
		});

		describe('convenience methods', () => {
			it('logSessionStart creates session_start event', () => {
				const event = eventLog.logSessionStart('task-1', { description: 'Test task' });

				expect(event.type).to.equal('session_start');
				expect(event.data.description).to.equal('Test task');
			});

			it('logSessionEnd creates session_end event', () => {
				const event = eventLog.logSessionEnd('task-1', { reason: 'complete', cost: 1.5 });

				expect(event.type).to.equal('session_end');
				expect(event.data.reason).to.equal('complete');
				expect(event.data.cost).to.equal(1.5);
			});

			it('logFeatureStart creates feature_start event', () => {
				const event = eventLog.logFeatureStart('task-1', 'ft-1', {
					description: 'Add feature',
					attempt: 2,
				});

				expect(event.type).to.equal('feature_start');
				expect(event.featureId).to.equal('ft-1');
				expect(event.data.attempt).to.equal(2);
			});

			it('logFeatureComplete creates feature_complete event', () => {
				const event = eventLog.logFeatureComplete('task-1', 'ft-1', {
					filesChanged: ['file.ts'],
					commits: ['abc123'],
				});

				expect(event.type).to.equal('feature_complete');
				expect(event.data.filesChanged).to.deep.equal(['file.ts']);
			});

			it('logFeatureFailed creates feature_failed event', () => {
				const event = eventLog.logFeatureFailed('task-1', 'ft-1', {
					error: 'Test failed',
					attempt: 1,
				});

				expect(event.type).to.equal('feature_failed');
				expect(event.data.error).to.equal('Test failed');
			});

			it('logTestRun creates test_run event', () => {
				const event = eventLog.logTestRun('task-1', 'ft-1', {
					passed: true,
					duration: 1500,
				});

				expect(event.type).to.equal('test_run');
				expect(event.data.passed).to.be.true;
				expect(event.data.duration).to.equal(1500);
			});

			it('logError creates error event', () => {
				const event = eventLog.logError('task-1', {
					error: 'Something went wrong',
					stack: 'Error: ...',
				});

				expect(event.type).to.equal('error');
				expect(event.data.error).to.equal('Something went wrong');
			});
		});

		describe('getEvents', () => {
			beforeEach(() => {
				eventLog.log('session_start', 'task-1', {});
				eventLog.log('feature_start', 'task-1', {}, { featureId: 'ft-1' });
				eventLog.log('feature_start', 'task-1', {}, { featureId: 'ft-2' });
				eventLog.log('error', 'task-1', {}, { featureId: 'ft-1' });
				eventLog.log('session_start', 'task-2', {});
			});

			it('returns all events with no filter', () => {
				const events = eventLog.getEvents();
				expect(events).to.have.length(5);
			});

			it('filters by type', () => {
				const events = eventLog.getEvents({ type: 'session_start' });
				expect(events).to.have.length(2);
				events.forEach((e) => expect(e.type).to.equal('session_start'));
			});

			it('filters by taskId', () => {
				const events = eventLog.getEvents({ taskId: 'task-1' });
				expect(events).to.have.length(4);
				events.forEach((e) => expect(e.taskId).to.equal('task-1'));
			});

			it('filters by featureId', () => {
				const events = eventLog.getEvents({ featureId: 'ft-1' });
				expect(events).to.have.length(2);
				events.forEach((e) => expect(e.featureId).to.equal('ft-1'));
			});

			it('combines filters', () => {
				const events = eventLog.getEvents({ type: 'feature_start', featureId: 'ft-1' });
				expect(events).to.have.length(1);
			});
		});

		describe('getRecentEvents', () => {
			it('returns last N events', () => {
				for (let i = 0; i < 30; i++) {
					eventLog.log('feature_start', 'task-1', { index: i });
				}

				const recent = eventLog.getRecentEvents(5);
				expect(recent).to.have.length(5);
				expect(recent[0].data.index).to.equal(25);
				expect(recent[4].data.index).to.equal(29);
			});

			it('returns all events if less than limit', () => {
				eventLog.log('session_start', 'task-1', {});
				eventLog.log('session_end', 'task-1', {});

				const recent = eventLog.getRecentEvents(10);
				expect(recent).to.have.length(2);
			});
		});

		describe('getErrors', () => {
			it('returns only error events', () => {
				eventLog.log('session_start', 'task-1', {});
				eventLog.log('error', 'task-1', { error: 'Error 1' });
				eventLog.log('feature_start', 'task-1', {});
				eventLog.log('error', 'task-1', { error: 'Error 2' });

				const errors = eventLog.getErrors();
				expect(errors).to.have.length(2);
				errors.forEach((e) => expect(e.type).to.equal('error'));
			});
		});

		describe('getFeatureEvents', () => {
			it('returns events for specific feature', () => {
				eventLog.log('feature_start', 'task-1', {}, { featureId: 'ft-1' });
				eventLog.log('test_run', 'task-1', {}, { featureId: 'ft-1' });
				eventLog.log('feature_start', 'task-1', {}, { featureId: 'ft-2' });
				eventLog.log('feature_complete', 'task-1', {}, { featureId: 'ft-1' });

				const events = eventLog.getFeatureEvents('ft-1');
				expect(events).to.have.length(3);
				events.forEach((e) => expect(e.featureId).to.equal('ft-1'));
			});
		});

		describe('subscribe', () => {
			it('notifies listener on new events', () => {
				const events: AgentEvent[] = [];
				eventLog.subscribe((event) => events.push(event));

				eventLog.log('session_start', 'task-1', {});
				eventLog.log('feature_start', 'task-1', {});

				expect(events).to.have.length(2);
			});

			it('unsubscribe stops notifications', () => {
				const events: AgentEvent[] = [];
				const unsubscribe = eventLog.subscribe((event) => events.push(event));

				eventLog.log('session_start', 'task-1', {});
				unsubscribe();
				eventLog.log('feature_start', 'task-1', {});

				expect(events).to.have.length(1);
			});
		});

		describe('subscribeToType', () => {
			it('only notifies for matching type', () => {
				const events: AgentEvent[] = [];
				eventLog.subscribeToType('error', (event) => events.push(event));

				eventLog.log('session_start', 'task-1', {});
				eventLog.log('error', 'task-1', { error: 'Error 1' });
				eventLog.log('feature_start', 'task-1', {});
				eventLog.log('error', 'task-1', { error: 'Error 2' });

				expect(events).to.have.length(2);
				events.forEach((e) => expect(e.type).to.equal('error'));
			});
		});

		describe('toJSON / toJSONLines', () => {
			it('toJSON returns valid JSON array', () => {
				eventLog.log('session_start', 'task-1', {});
				eventLog.log('session_end', 'task-1', {});

				const json = eventLog.toJSON();
				const parsed = JSON.parse(json);
				expect(parsed).to.be.an('array').with.length(2);
			});

			it('toJSONLines returns valid JSON Lines', () => {
				eventLog.log('session_start', 'task-1', {});
				eventLog.log('session_end', 'task-1', {});

				const jsonl = eventLog.toJSONLines();
				const lines = jsonl.split('\n');
				expect(lines).to.have.length(2);
				lines.forEach((line) => {
					expect(() => JSON.parse(line)).not.to.throw();
				});
			});
		});

		describe('clear', () => {
			it('removes all events', () => {
				eventLog.log('session_start', 'task-1', {});
				eventLog.log('session_end', 'task-1', {});
				expect(eventLog.getEvents()).to.have.length(2);

				eventLog.clear();
				expect(eventLog.getEvents()).to.have.length(0);
			});
		});
	});
});

describe('observability/monitor', () => {
	// =============================================================================
	// AgentMonitor Tests
	// =============================================================================

	describe('AgentMonitor', () => {
		let monitor: AgentMonitor;

		beforeEach(() => {
			monitor = new AgentMonitor('task-1', '/tmp/test');
		});

		describe('initial state', () => {
			it('has correct default values', () => {
				const state = monitor.getState();

				expect(state.taskId).to.equal('task-1');
				expect(state.currentPhase).to.equal('initializing');
				expect(state.isActive).to.be.true;
				expect(state.progress.completed).to.equal(0);
				expect(state.progress.total).to.equal(0);
				expect(state.cost.total).to.equal(0);
				expect(state.recentEvents).to.deep.equal([]);
				expect(state.errors).to.deep.equal([]);
			});
		});

		describe('setPhase', () => {
			it('updates the current phase', () => {
				monitor.setPhase('working');
				expect(monitor.getState().currentPhase).to.equal('working');

				monitor.setPhase('reviewing');
				expect(monitor.getState().currentPhase).to.equal('reviewing');
			});
		});

		describe('setCurrentFeature', () => {
			it('sets feature id and description', () => {
				monitor.setCurrentFeature('ft-1', 'Add authentication');
				const state = monitor.getState();

				expect(state.currentFeatureId).to.equal('ft-1');
				expect(state.currentFeatureDescription).to.equal('Add authentication');
			});
		});

		describe('clearCurrentFeature', () => {
			it('clears feature id and description', () => {
				monitor.setCurrentFeature('ft-1', 'Add auth');
				monitor.clearCurrentFeature();
				const state = monitor.getState();

				expect(state.currentFeatureId).to.be.undefined;
				expect(state.currentFeatureDescription).to.be.undefined;
			});
		});

		describe('setProgress', () => {
			it('updates progress state', () => {
				monitor.setProgress({
					completed: 5,
					total: 10,
					failing: 1,
					blocked: 2,
				});
				const state = monitor.getState();

				expect(state.progress.completed).to.equal(5);
				expect(state.progress.total).to.equal(10);
				expect(state.progress.failing).to.equal(1);
				expect(state.progress.blocked).to.equal(2);
			});
		});

		describe('incrementCompleted', () => {
			it('increments completed count', () => {
				monitor.incrementCompleted();
				expect(monitor.getState().progress.completed).to.equal(1);

				monitor.incrementCompleted();
				expect(monitor.getState().progress.completed).to.equal(2);
			});
		});

		describe('incrementFailing', () => {
			it('increments failing count', () => {
				monitor.incrementFailing();
				expect(monitor.getState().progress.failing).to.equal(1);
			});
		});

		describe('addCost', () => {
			it('adds to total and breakdown', () => {
				monitor.addCost(1.5, 'implementation');
				monitor.addCost(0.5, 'review');
				const state = monitor.getState();

				expect(state.cost.total).to.equal(2.0);
				expect(state.cost.breakdown.implementation).to.equal(1.5);
				expect(state.cost.breakdown.review).to.equal(0.5);
			});
		});

		describe('setTotalCost', () => {
			it('sets total cost', () => {
				monitor.setTotalCost(10.5);
				expect(monitor.getState().cost.total).to.equal(10.5);
			});
		});

		describe('event log integration', () => {
			let eventLog: EventLog;

			beforeEach(() => {
				eventLog = new EventLog();
				monitor.connectEventLog(eventLog);
			});

			afterEach(() => {
				monitor.disconnectEventLog();
			});

			it('updates phase on session_start', () => {
				eventLog.log('session_start', 'task-1', {});
				expect(monitor.getState().currentPhase).to.equal('initializing');
			});

			it('updates phase and feature on feature_start', () => {
				eventLog.log('feature_start', 'task-1', { description: 'Add auth' }, { featureId: 'ft-1' });
				const state = monitor.getState();

				expect(state.currentPhase).to.equal('working');
				expect(state.currentFeatureId).to.equal('ft-1');
			});

			it('collects error events', () => {
				eventLog.log('error', 'task-1', { error: 'Something went wrong' });
				expect(monitor.getState().errors).to.have.length(1);
			});

			it('keeps last 20 recent events', () => {
				for (let i = 0; i < 25; i++) {
					eventLog.log('feature_start', 'task-1', { index: i });
				}
				expect(monitor.getState().recentEvents).to.have.length(20);
			});

			it('stops receiving events after disconnect', () => {
				eventLog.log('feature_start', 'task-1', {});
				expect(monitor.getState().recentEvents).to.have.length(1);

				monitor.disconnectEventLog();
				eventLog.log('feature_complete', 'task-1', {});
				expect(monitor.getState().recentEvents).to.have.length(1);
			});
		});
	});
});
