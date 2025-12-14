import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { deepEqual, extractCommonProperties } from './arrayUtils';

describe('arrayUtils', () => {
	setupConditionalLoggerOutput();
	describe('extractCommonProperties', () => {
		it('should return empty common properties for empty array', () => {
			const result = extractCommonProperties([]);

			expect(result.commonProps).to.deep.equal({});
			expect(result.strippedItems).to.deep.equal([]);
		});

		it('should return empty common properties for single log', () => {
			const logs = [{ id: '123', message: 'test' }];
			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({});
			expect(result.strippedItems).to.deep.equal(logs);
		});

		it('should extract common top-level properties', () => {
			const logs = [
				{ id: '1', severity: 'INFO', message: 'first' },
				{ id: '2', severity: 'INFO', message: 'second' },
				{ id: '3', severity: 'INFO', message: 'third' },
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({ severity: 'INFO' });
			expect(result.strippedItems).to.deep.equal([
				{ id: '1', message: 'first' },
				{ id: '2', message: 'second' },
				{ id: '3', message: 'third' },
			]);
		});

		it('should handle no common properties', () => {
			const logs = [
				{ id: '1', severity: 'INFO' },
				{ id: '2', severity: 'ERROR' },
				{ id: '3', severity: 'WARN' },
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({});
			expect(result.strippedItems).to.deep.equal(logs);
		});
	});

	describe('Nested properties', () => {
		it('should extract common nested properties', () => {
			const logs = [
				{
					id: '1',
					resource: {
						type: 'cloud_scheduler_job',
						labels: { project_id: 'test-project', job_id: 'job-1' },
					},
				},
				{
					id: '2',
					resource: {
						type: 'cloud_scheduler_job',
						labels: { project_id: 'test-project', job_id: 'job-2' },
					},
				},
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({
				resource: {
					type: 'cloud_scheduler_job',
					labels: { project_id: 'test-project' },
				},
			});

			expect(result.strippedItems).to.deep.equal([
				{ id: '1', resource: { labels: { job_id: 'job-1' } } },
				{ id: '2', resource: { labels: { job_id: 'job-2' } } },
			]);
		});

		it('should handle deeply nested common properties', () => {
			const logs = [
				{
					id: '1',
					metadata: {
						level1: {
							level2: {
								level3: 'common-value',
							},
						},
					},
				},
				{
					id: '2',
					metadata: {
						level1: {
							level2: {
								level3: 'common-value',
							},
						},
					},
				},
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({
				metadata: {
					level1: {
						level2: {
							level3: 'common-value',
						},
					},
				},
			});

			expect(result.strippedItems).to.deep.equal([{ id: '1' }, { id: '2' }]);
		});

		it('should cleanup empty parent objects after stripping', () => {
			const logs = [
				{
					id: '1',
					resource: {
						labels: {
							project_id: 'test-project',
						},
					},
				},
				{
					id: '2',
					resource: {
						labels: {
							project_id: 'test-project',
						},
					},
				},
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({
				resource: {
					labels: {
						project_id: 'test-project',
					},
				},
			});

			// Should not have empty resource or labels objects
			expect(result.strippedItems).to.deep.equal([{ id: '1' }, { id: '2' }]);
		});
	});

	describe('Array handling', () => {
		it('should treat arrays as leaf values', () => {
			const logs = [
				{ id: '1', tags: ['a', 'b', 'c'] },
				{ id: '2', tags: ['a', 'b', 'c'] },
				{ id: '3', tags: ['a', 'b', 'c'] },
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({
				tags: ['a', 'b', 'c'],
			});

			expect(result.strippedItems).to.deep.equal([{ id: '1' }, { id: '2' }, { id: '3' }]);
		});

		it('should not extract arrays with different values', () => {
			const logs = [
				{ id: '1', tags: ['a', 'b'] },
				{ id: '2', tags: ['a', 'c'] },
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({});
			expect(result.strippedItems).to.deep.equal(logs);
		});

		it('should handle arrays with different lengths', () => {
			const logs = [
				{ id: '1', tags: ['a', 'b'] },
				{ id: '2', tags: ['a', 'b', 'c'] },
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({});
			expect(result.strippedItems).to.deep.equal(logs);
		});
	});

	describe('Real-world Google Cloud log examples', () => {
		it('should extract common properties from Cloud Scheduler logs', () => {
			const logs = [
				{
					insertId: 'abc123def456',
					jsonPayload: {
						jobName: 'projects/my-project-123/locations/us-central1/jobs/scheduled-job-name',
						url: 'https://my-service-xyz.run.app/api/v1/endpoint',
						targetType: 'HTTP',
						scheduledTime: '2025-10-15T06:00:00.337059Z',
						'@type': 'type.googleapis.com/google.cloud.scheduler.logging.AttemptStarted',
					},
					resource: {
						type: 'cloud_scheduler_job',
						labels: {
							project_id: 'my-project-123',
							job_id: 'scheduled-job-name',
							location: 'us-central1',
						},
					},
					timestamp: '2025-10-15T06:00:02.109538210Z',
					severity: 'INFO',
					logName: 'projects/my-project-123/logs/cloudscheduler.googleapis.com%2Fexecutions',
					receiveTimestamp: '2025-10-15T06:00:02.109538210Z',
				},
				{
					insertId: 'xyz789ghi012',
					jsonPayload: {
						jobName: 'projects/my-project-123/locations/us-central1/jobs/scheduled-job-name',
						url: 'https://my-service-xyz.run.app/api/v1/endpoint',
						targetType: 'HTTP',
						scheduledTime: '2025-10-15T07:00:00.337059Z',
						'@type': 'type.googleapis.com/google.cloud.scheduler.logging.AttemptStarted',
					},
					resource: {
						type: 'cloud_scheduler_job',
						labels: {
							project_id: 'my-project-123',
							job_id: 'scheduled-job-name',
							location: 'us-central1',
						},
					},
					timestamp: '2025-10-15T07:00:02.109538210Z',
					severity: 'INFO',
					logName: 'projects/my-project-123/logs/cloudscheduler.googleapis.com%2Fexecutions',
					receiveTimestamp: '2025-10-15T07:00:02.109538210Z',
				},
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({
				jsonPayload: {
					jobName: 'projects/my-project-123/locations/us-central1/jobs/scheduled-job-name',
					url: 'https://my-service-xyz.run.app/api/v1/endpoint',
					targetType: 'HTTP',
					'@type': 'type.googleapis.com/google.cloud.scheduler.logging.AttemptStarted',
				},
				resource: {
					type: 'cloud_scheduler_job',
					labels: {
						project_id: 'my-project-123',
						job_id: 'scheduled-job-name',
						location: 'us-central1',
					},
				},
				severity: 'INFO',
				logName: 'projects/my-project-123/logs/cloudscheduler.googleapis.com%2Fexecutions',
			});

			expect(result.strippedItems[0]).to.have.property('insertId', 'abc123def456');
			expect(result.strippedItems[0]).to.have.property('timestamp', '2025-10-15T06:00:02.109538210Z');
			expect(result.strippedItems[0].jsonPayload).to.have.property('scheduledTime', '2025-10-15T06:00:00.337059Z');
		});
	});

	describe('Edge cases', () => {
		it('should handle null values', () => {
			const logs = [
				{ id: '1', value: null },
				{ id: '2', value: null },
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({ value: null });
			expect(result.strippedItems).to.deep.equal([{ id: '1' }, { id: '2' }]);
		});

		it('should handle undefined values', () => {
			const logs = [
				{ id: '1', value: undefined },
				{ id: '2', value: undefined },
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({ value: undefined });
		});

		it('should handle mixed types correctly', () => {
			const logs = [
				{ id: '1', count: 42 },
				{ id: '2', count: '42' }, // string instead of number
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({});
			expect(result.strippedItems).to.deep.equal(logs);
		});

		it('should handle boolean values', () => {
			const logs = [
				{ id: '1', isActive: true },
				{ id: '2', isActive: true },
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({ isActive: true });
		});

		it('should handle objects with different key sets', () => {
			const logs = [
				{ id: '1', metadata: { a: 1, b: 2 } },
				{ id: '2', metadata: { a: 1, c: 3 } },
			];

			const result = extractCommonProperties(logs);

			expect(result.commonProps).to.deep.equal({
				metadata: { a: 1 },
			});
		});
	});

	describe('deepEqual helper', () => {
		it('should correctly compare primitives', () => {
			expect(deepEqual(1, 1)).to.be.true;
			expect(deepEqual('a', 'a')).to.be.true;
			expect(deepEqual(true, true)).to.be.true;
			expect(deepEqual(1, 2)).to.be.false;
			expect(deepEqual('a', 'b')).to.be.false;
		});

		it('should correctly compare arrays', () => {
			expect(deepEqual([1, 2, 3], [1, 2, 3])).to.be.true;
			expect(deepEqual([1, 2], [1, 2, 3])).to.be.false;
			expect(deepEqual([1, 2, 3], [1, 3, 2])).to.be.false;
		});

		it('should correctly compare objects', () => {
			expect(deepEqual({ a: 1 }, { a: 1 })).to.be.true;
			expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).to.be.true;
			expect(deepEqual({ a: 1 }, { a: 2 })).to.be.false;
			expect(deepEqual({ a: 1 }, { b: 1 })).to.be.false;
		});

		it('should handle null and undefined', () => {
			expect(deepEqual(null, null)).to.be.true;
			expect(deepEqual(undefined, undefined)).to.be.true;
			expect(deepEqual(null, undefined)).to.be.false;
			expect(deepEqual(null, 0)).to.be.false;
		});

		it('should compare nested structures', () => {
			const obj1 = { a: { b: { c: [1, 2, 3] } } };
			const obj2 = { a: { b: { c: [1, 2, 3] } } };
			const obj3 = { a: { b: { c: [1, 2, 4] } } };

			expect(deepEqual(obj1, obj2)).to.be.true;
			expect(deepEqual(obj1, obj3)).to.be.false;
		});
	});
});
