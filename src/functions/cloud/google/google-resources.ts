/**
 * Google Cloud resource discovery and service-specific metrics.
 *
 * This module contains functions for discovering and querying specific GCP resources
 * like Redis, Bigtable, Spanner, Load Balancers, MIGs, and WAF Controller metrics.
 *
 * For generic GCP operations (logging, monitoring, gcloud commands), use GoogleCloud.
 */

import { stringify as yamlStringify } from 'yaml';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { execCommand } from '#utils/exec';
import { GoogleCloud } from './google-cloud';

// Types for resource discovery
export interface RedisInstance {
	name: string;
	displayName: string;
	region: string;
	tier: string;
	memorySizeGb: number;
	host: string;
	port: number;
	state: string;
}

export interface BigtableInstance {
	name: string;
	displayName: string;
	state: string;
	type: string;
}

export interface SpannerInstance {
	name: string;
	displayName: string;
	nodeCount: number;
	processingUnits: number;
	state: string;
}

@funcClass(__filename)
export class GoogleResources {
	private gcp: GoogleCloud;

	constructor() {
		this.gcp = new GoogleCloud();
	}

	// ==================== Resource Discovery ====================

	/**
	 * Lists all Redis (Memorystore) instances in a project.
	 * @param projectId The Google Cloud project ID
	 * @returns Array of Redis instances with their details
	 */
	@func()
	async listRedisInstances(projectId: string): Promise<RedisInstance[]> {
		// Use --region=- to list instances across all regions
		const cmd = `gcloud redis instances list --project=${projectId} --region=- --format=json`;
		const result = await execCommand(cmd);
		if (result.exitCode > 0) throw new Error(`Error listing Redis instances: ${result.stderr}`);

		try {
			const instances = JSON.parse(result.stdout || '[]');
			return instances.map((i: any) => ({
				name: i.name?.split('/').pop() || i.name,
				displayName: i.displayName || i.name?.split('/').pop(),
				region: i.locationId || i.name?.split('/')[3],
				tier: i.tier,
				memorySizeGb: i.memorySizeGb,
				host: i.host,
				port: i.port,
				state: i.state,
			}));
		} catch (e) {
			return [];
		}
	}

	/**
	 * Lists all Bigtable instances in a project.
	 * @param projectId The Google Cloud project ID
	 * @returns Array of Bigtable instances with their details
	 */
	@func()
	async listBigtableInstances(projectId: string): Promise<BigtableInstance[]> {
		const cmd = `gcloud bigtable instances list --project=${projectId} --format=json`;
		const result = await execCommand(cmd);
		if (result.exitCode > 0) throw new Error(`Error listing Bigtable instances: ${result.stderr}`);

		try {
			const instances = JSON.parse(result.stdout || '[]');
			return instances.map((i: any) => ({
				name: i.name?.split('/').pop() || i.name,
				displayName: i.displayName || i.name?.split('/').pop(),
				state: i.state,
				type: i.type,
			}));
		} catch (e) {
			return [];
		}
	}

	/**
	 * Lists all Spanner instances in a project.
	 * @param projectId The Google Cloud project ID
	 * @returns Array of Spanner instances with their details
	 */
	@func()
	async listSpannerInstances(projectId: string): Promise<SpannerInstance[]> {
		const cmd = `gcloud spanner instances list --project=${projectId} --format=json`;
		const result = await execCommand(cmd);
		if (result.exitCode > 0) throw new Error(`Error listing Spanner instances: ${result.stderr}`);

		try {
			const instances = JSON.parse(result.stdout || '[]');
			return instances.map((i: any) => ({
				name: i.name?.split('/').pop() || i.name,
				displayName: i.displayName || i.name?.split('/').pop(),
				nodeCount: i.nodeCount || 0,
				processingUnits: i.processingUnits || 0,
				state: i.state,
			}));
		} catch (e) {
			return [];
		}
	}

	// ==================== Service-Specific Metrics ====================

	/**
	 * Gets Spanner instance metrics (CPU, latency, storage).
	 * @param projectId The Google Cloud project ID
	 * @param instanceId The Spanner instance ID
	 * @param options Configuration options
	 * @returns Metrics data as YAML string
	 */
	@func()
	async getSpannerMetrics(projectId: string, instanceId: string, options?: { intervalMinutes?: number }): Promise<string> {
		const intervalMinutes = options?.intervalMinutes ?? 60;

		const metrics = [
			'spanner.googleapis.com/instance/cpu/utilization',
			'spanner.googleapis.com/api/request_latencies',
			'spanner.googleapis.com/instance/storage/used_bytes',
		];

		const results: Record<string, any> = { instanceId, metrics: {} };

		for (const metricType of metrics) {
			try {
				const data = await this.gcp.getCloudMonitoringMetrics(projectId, metricType, {
					filter: `resource.labels.instance_id="${instanceId}"`,
					intervalMinutes,
					alignmentPeriodSeconds: 300,
					aggregation: 'ALIGN_MEAN',
				});
				results.metrics[metricType.split('/').pop() || metricType] = data;
			} catch (e: any) {
				results.metrics[metricType.split('/').pop() || metricType] = `Error: ${e.message}`;
			}
		}

		return yamlStringify(results, { indent: 2 });
	}

	/**
	 * Gets Bigtable instance metrics (latency, request count).
	 * @param projectId The Google Cloud project ID
	 * @param instanceId The Bigtable instance ID
	 * @param options Configuration options
	 * @returns Metrics data as YAML string
	 */
	@func()
	async getBigtableMetrics(projectId: string, instanceId: string, options?: { intervalMinutes?: number }): Promise<string> {
		const intervalMinutes = options?.intervalMinutes ?? 60;

		// Define metrics with appropriate aligners (latencies is a distribution metric)
		const metricsConfig = [
			{ type: 'bigtable.googleapis.com/server/latencies', aggregation: 'ALIGN_DELTA' as const },
			{ type: 'bigtable.googleapis.com/server/request_count', aggregation: 'ALIGN_SUM' as const },
		];

		const results: Record<string, any> = { instanceId, metrics: {} };

		for (const { type: metricType, aggregation } of metricsConfig) {
			try {
				const data = await this.gcp.getCloudMonitoringMetrics(projectId, metricType, {
					filter: `resource.labels.instance="${instanceId}"`,
					intervalMinutes,
					alignmentPeriodSeconds: 300,
					aggregation,
				});
				results.metrics[metricType.split('/').pop() || metricType] = data;
			} catch (e: any) {
				results.metrics[metricType.split('/').pop() || metricType] = `Error: ${e.message}`;
			}
		}

		return yamlStringify(results, { indent: 2 });
	}

	/**
	 * Gets Redis (Memorystore) instance metrics.
	 * @param projectId The Google Cloud project ID
	 * @param instanceId The Redis instance ID
	 * @param region The region where the instance is located
	 * @param options Configuration options
	 * @returns Metrics data as YAML string
	 */
	@func()
	async getRedisMetrics(projectId: string, instanceId: string, region: string, options?: { intervalMinutes?: number }): Promise<string> {
		const intervalMinutes = options?.intervalMinutes ?? 60;

		const metrics = [
			'redis.googleapis.com/stats/memory/usage_ratio',
			'redis.googleapis.com/stats/connected_clients',
			'redis.googleapis.com/stats/keyspace_hits',
			'redis.googleapis.com/stats/cpu_utilization',
		];

		const results: Record<string, any> = { instanceId, region, metrics: {} };

		for (const metricType of metrics) {
			try {
				const data = await this.gcp.getCloudMonitoringMetrics(projectId, metricType, {
					filter: `resource.labels.instance_id="${instanceId}" AND resource.labels.region="${region}"`,
					intervalMinutes,
					alignmentPeriodSeconds: 300,
					aggregation: 'ALIGN_MEAN',
				});
				results.metrics[metricType.split('/').pop() || metricType] = data;
			} catch (e: any) {
				results.metrics[metricType.split('/').pop() || metricType] = `Error: ${e.message}`;
			}
		}

		return yamlStringify(results, { indent: 2 });
	}

	/**
	 * Gets HTTP(S) Load Balancer metrics.
	 * @param projectId The Google Cloud project ID
	 * @param backendServiceName The backend service name (or '*' for all)
	 * @param options Configuration options
	 * @returns Metrics data as YAML string
	 */
	@func()
	async getLoadBalancerMetrics(projectId: string, backendServiceName: string, options?: { intervalMinutes?: number }): Promise<string> {
		const intervalMinutes = options?.intervalMinutes ?? 60;

		const metrics = [
			'loadbalancing.googleapis.com/https/request_count',
			'loadbalancing.googleapis.com/https/backend_latencies',
			'loadbalancing.googleapis.com/https/total_latencies',
		];

		const results: Record<string, any> = { backendServiceName, metrics: {} };

		for (const metricType of metrics) {
			try {
				const filter = backendServiceName === '*' ? '' : `resource.labels.backend_service_name="${backendServiceName}"`;

				const data = await this.gcp.getCloudMonitoringMetrics(projectId, metricType, {
					filter: filter || undefined,
					intervalMinutes,
					alignmentPeriodSeconds: 60,
					aggregation: 'ALIGN_SUM',
				});
				results.metrics[metricType.split('/').pop() || metricType] = data;
			} catch (e: any) {
				results.metrics[metricType.split('/').pop() || metricType] = `Error: ${e.message}`;
			}
		}

		return yamlStringify(results, { indent: 2 });
	}

	/**
	 * Gets Compute Engine instance CPU and network metrics.
	 * @param projectId The Google Cloud project ID
	 * @param instanceNameFilter Filter for instance names (prefix pattern - informational only)
	 * @param options Configuration options
	 * @returns Metrics data as YAML string
	 */
	@func()
	async getComputeMetrics(projectId: string, instanceNameFilter?: string, options?: { intervalMinutes?: number }): Promise<string> {
		const intervalMinutes = options?.intervalMinutes ?? 60;

		const metrics = [
			'compute.googleapis.com/instance/cpu/utilization',
			'compute.googleapis.com/instance/network/received_bytes_count',
			'compute.googleapis.com/instance/network/sent_bytes_count',
		];

		const results: Record<string, any> = { instanceNameFilter, metrics: {} };

		for (const metricType of metrics) {
			try {
				// Query without filter (Cloud Monitoring API has limited filter support)
				const data = await this.gcp.getCloudMonitoringMetrics(projectId, metricType, {
					intervalMinutes,
					alignmentPeriodSeconds: 60,
					aggregation: 'ALIGN_MEAN',
				});
				results.metrics[metricType.split('/').pop() || metricType] = data;
			} catch (e: any) {
				results.metrics[metricType.split('/').pop() || metricType] = `Error: ${e.message}`;
			}
		}

		return yamlStringify(results, { indent: 2 });
	}

	/**
	 * Gets Managed Instance Group (MIG) metrics.
	 * @param projectId The Google Cloud project ID
	 * @param migNameFilter Filter for MIG names (prefix pattern - informational only)
	 * @param options Configuration options
	 * @returns Metrics data as YAML string
	 */
	@func()
	async getMigMetrics(projectId: string, migNameFilter?: string, options?: { intervalMinutes?: number }): Promise<string> {
		const intervalMinutes = options?.intervalMinutes ?? 60;

		const metrics = ['compute.googleapis.com/instance_group/size', 'compute.googleapis.com/instance_group/autoscaler/serving_percentage'];

		const results: Record<string, any> = { migNameFilter, metrics: {} };

		for (const metricType of metrics) {
			try {
				// Query without filter (Cloud Monitoring API has limited filter support for resource labels)
				const data = await this.gcp.getCloudMonitoringMetrics(projectId, metricType, {
					intervalMinutes,
					alignmentPeriodSeconds: 60,
					aggregation: 'ALIGN_MEAN',
				});
				results.metrics[metricType.split('/').pop() || metricType] = data;
			} catch (e: any) {
				results.metrics[metricType.split('/').pop() || metricType] = `Error: ${e.message}`;
			}
		}

		return yamlStringify(results, { indent: 2 });
	}

	/**
	 * Gets WAF Controller custom metrics for a specific service.
	 * See WAF_CONTROLLER_O11Y.md for metric definitions.
	 * @param projectId The Google Cloud project ID
	 * @param wafGroup The WAF service group (api, click, impression, post, ppc)
	 * @param options Configuration options
	 * @returns Metrics data as YAML string
	 */
	@func()
	async getWafControllerMetrics(projectId: string, wafGroup: string, options?: { intervalMinutes?: number; environment?: string }): Promise<string> {
		const intervalMinutes = options?.intervalMinutes ?? 60;
		const environment = options?.environment ?? 'prod';

		const metrics = [
			'custom.googleapis.com/waf/scaling/cpu_current',
			'custom.googleapis.com/waf/scaling/cpu_stabilized',
			'custom.googleapis.com/waf/scaling/cpu_predicted',
			'custom.googleapis.com/waf/scaling/instances_target',
			'custom.googleapis.com/waf/scaling/instance_gap',
			'custom.googleapis.com/waf/scaling/gap_duration_seconds',
			'custom.googleapis.com/waf/gcp/autoscaler_update_success',
			'custom.googleapis.com/waf/preemption',
		];

		const results: Record<string, any> = { wafGroup, environment, metrics: {} };

		// Query all metrics in parallel with waf_group label filter
		const metricsResults = await Promise.all(
			metrics.map(async (metricType) => {
				try {
					const data = await this.gcp.getCloudMonitoringMetrics(projectId, metricType, {
						filter: `metric.labels.waf_group="${wafGroup}" AND metric.labels.environment="${environment}"`,
						intervalMinutes,
						alignmentPeriodSeconds: 60,
						aggregation: 'ALIGN_MEAN',
					});
					return { metricType, data, error: null };
				} catch (e: any) {
					return { metricType, data: null, error: e.message };
				}
			}),
		);

		for (const { metricType, data, error } of metricsResults) {
			const metricName = metricType.split('/').pop() || metricType;
			results.metrics[metricName] = error ? `Error: ${error}` : data;
		}

		return yamlStringify(results, { indent: 2 });
	}
}
