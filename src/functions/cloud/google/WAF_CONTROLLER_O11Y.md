# ============================================================================
# WAF Controller Observability Instrumentation
# ============================================================================
#
# IMPORTANT: All logs from the controller components automatically include
# `wafGroup` via child loggers. This enables filtering all logs for a specific
# WAF group (api, click, impression, post, ppc) using:
#
#   jsonPayload.wafGroup="api"
#
# wafGroup values: api | click | impression | post | ppc
# environment values: prod | stage | dev
#
# ============================================================================

# ============================================================================
# How wafGroup is Included in Logs
# ============================================================================
#
# The following components use logger.child({ wafGroup }) pattern, which
# automatically adds wafGroup to ALL log entries from that component:
#
#   - MigController      (src/controller/mig-controller.ts:130)
#   - MigManager         (src/controller/mig-manager.ts:39)
#   - MetricsCollector   (src/controller/metrics-collector.ts:51)
#   - ObservabilityService (src/controller/observability.ts:60)
#
# ZoneExhaustionMonitor adds wafGroup explicitly when it can be determined
# from the resource name in Cloud Logging events.
#
# ============================================================================

metrics:
  # ---------------------------------------------------------------------------
  # Scaling Decision Metrics (emitted every control loop cycle)
  # ---------------------------------------------------------------------------
  - name: custom.googleapis.com/waf/scaling/cpu_current
    type: gauge
    labels: [waf_group, environment]
    description: Current total CPU utilization sum across all healthy instances
    file: src/controller/observability.ts:73-76

  - name: custom.googleapis.com/waf/scaling/cpu_stabilized
    type: gauge
    labels: [waf_group, environment]
    description: Stabilized CPU (max over recent 2-minute history window)
    file: src/controller/observability.ts:77-80

  - name: custom.googleapis.com/waf/scaling/cpu_predicted
    type: gauge
    labels: [waf_group, environment]
    description: Predicted CPU with predictive scaling applied
    file: src/controller/observability.ts:81-86

  - name: custom.googleapis.com/waf/scaling/instances_target
    type: gauge
    labels: [waf_group, environment, mig_type]
    description: Target instance count per MIG type (std, spot1, spot2, spot3)
    file: src/controller/observability.ts:91-111

  # ---------------------------------------------------------------------------
  # Instance Gap Metrics (capacity tracking)
  # ---------------------------------------------------------------------------
  - name: custom.googleapis.com/waf/scaling/instance_gap
    type: gauge
    labels: [waf_group, environment]
    description: Number of missing instances (target - healthy)
    file: src/controller/observability.ts:125-131

  - name: custom.googleapis.com/waf/scaling/gap_duration_seconds
    type: gauge
    labels: [waf_group, environment]
    description: How long the instance gap has persisted (only emitted when gap > 0)
    file: src/controller/observability.ts:137-141

  # ---------------------------------------------------------------------------
  # Autoscaler Update Metrics (GCP API operations)
  # ---------------------------------------------------------------------------
  - name: custom.googleapis.com/waf/gcp/autoscaler_update_latency_ms
    type: gauge
    labels: [waf_group, environment, mig_type]
    description: Latency of GCP autoscaler update API call in milliseconds
    file: src/controller/observability.ts:197-202

  - name: custom.googleapis.com/waf/gcp/autoscaler_update_success
    type: gauge
    labels: [waf_group, environment, mig_type]
    description: Success indicator for autoscaler updates (1=success, 0=failure)
    file: src/controller/observability.ts:203-207

  - name: custom.googleapis.com/waf/gcp/retry_count
    type: gauge
    labels: [waf_group, environment, mig_type]
    description: Number of retry attempts for autoscaler updates
    file: src/controller/observability.ts:208-212

  # ---------------------------------------------------------------------------
  # Preemption Metrics
  # ---------------------------------------------------------------------------
  - name: custom.googleapis.com/waf/preemption
    type: gauge
    labels: [machine_type, zone, instance_age]
    description: Preemption events with VM age bucketed to power-of-2 minutes
    file: src/gcp/metrics.ts:75-91
    notes: |
      instance_age is log2-bucketed (1, 2, 4, 8, 16, 32, 64, 128, 256, 512 minutes)
      Helps identify if preemptions cluster around certain VM ages

# ============================================================================
# Structured Logs
# ============================================================================
#
# All logs include wafGroup automatically via child logger pattern.
# Filter by WAF group: jsonPayload.wafGroup="api"
#
# ============================================================================

logs:
  # ---------------------------------------------------------------------------
  # Scaling Decision (THE most important log for understanding scaling)
  # ---------------------------------------------------------------------------
  - event: scaling_decision
    severity: INFO
    message_pattern: "Scaling {wafGroup}: std={n} spot1={n} spot2={n} spot3={n} total={n} | cpu={n}% stable={n}% pred={n}%"
    fields:
      wafGroup: string  # api, click, impression, post, ppc (auto-included via child logger)
      event: '"scaling_decision"'
      environment: string  # prod, stage, dev
      currentCpu: number  # Raw CPU sum across instances
      stabilizedCpu: number  # Max CPU from recent history
      predictedCpu: number  # Predicted future CPU
      cpuHistoryLength: number  # Data points in history
      instanceCpuValues: number[]  # Individual instance CPUs (sorted)
      standardInstances: number  # Target std MIG count
      spot1Instances: number  # Target spot1 MIG count
      spot2Instances: number  # Target spot2 MIG count
      spot3Instances: number  # Target spot3 MIG count
      totalInstances: number  # Sum of all targets
      healthyInstances: number  # Current healthy count
      instanceGap: number  # target - healthy
      loadBalancerRps: number  # Current LB RPS
      totalInstanceRps: number  # Sum of instance-reported RPS
      recentPreemptions: number  # Count of recent preemptions
      preemptedHosts: string[]  # Hostnames that were preempted
      migHealthScores: object  # {spot1, spot2, spot3, averageSpotHealth}
      standardBoost: number  # Extra std instances due to spot degradation
      spotBuffer: number  # Configured spot buffer
      targetCpuUtilisation: number  # Target CPU %
      reason: string  # Human-readable scaling reason
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.event="scaling_decision"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-manager.ts:202-251

  # ---------------------------------------------------------------------------
  # Instance Gap Alerts (capacity shortfall)
  # ---------------------------------------------------------------------------
  - event: instance_gap_alert
    severity: WARN
    message_pattern: "Instance gap of {gap} ({gapPercent}%) persisting for {gapDurationSeconds}s"
    fields:
      wafGroup: string  # auto-included via child logger
      event: '"instance_gap_alert"'
      environment: string
      gap: number  # Missing instances count
      gapPercent: number  # Percentage of target missing
      gapDurationSeconds: number  # How long gap persisted
      targetInstances: number  # Total target
      healthyInstances: number  # Current healthy
    conditions:
      - gap > 0
      - gapDurationSeconds > 60
      - gap >= 10% of targetInstances
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.event="instance_gap_alert"
      jsonPayload.wafGroup="api"  # Filter by WAF group
      severity="WARNING"
    file: src/controller/observability.ts:160-172

  - event: instance_gap_resolved
    severity: INFO
    message_pattern: "Instance gap resolved"
    fields:
      wafGroup: string  # auto-included via child logger
      event: '"instance_gap_resolved"'
      environment: string
      gap: number  # Now 0
      targetInstances: number
      healthyInstances: number
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.event="instance_gap_resolved"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/observability.ts:174-186

  # ---------------------------------------------------------------------------
  # Zone Exhaustion Events (spot capacity issues)
  # ---------------------------------------------------------------------------
  - event: zone_exhausted
    severity: INFO
    message_pattern: "Zone {zone} exhausted for {migType}"
    fields:
      wafGroup: string  # auto-included via child logger
      event: '"zone_exhausted"'
      migType: string  # std, spot1, spot2, spot3
      zone: string  # e.g., us-central1-a
      vmType: string  # Machine type (optional)
      healthScore: number  # Current MIG health score 0.0-1.0
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.event="zone_exhausted"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-controller.ts:199-208

  - event: zone_success
    severity: INFO
    message_pattern: "Instance created in {zone} for {migType}"
    fields:
      wafGroup: string  # auto-included via child logger
      event: '"zone_success"'
      migType: string
      zone: string
      healthScore: number
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.event="zone_success"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-controller.ts:216-224

  # ---------------------------------------------------------------------------
  # Preemption Notifications
  # ---------------------------------------------------------------------------
  - event: preemption_notice
    severity: INFO
    message_pattern: "Preemption notice"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"Preemption notice"'
      zone: string
      host: string  # Hostname of preempted VM
      machineType: string
      age: string  # Human-readable duration (e.g., "2h 15m")
      ageBucket: number  # Power-of-2 minutes
      preemptTime: string  # ISO timestamp
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.message="Preemption notice"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-controller.ts:236-244

  # ---------------------------------------------------------------------------
  # Autoscaler Update Events
  # ---------------------------------------------------------------------------
  - event: autoscaler_update_failure
    severity: ERROR
    message_pattern: "Autoscaler {autoscaler} update failed"
    fields:
      wafGroup: string  # auto-included via child logger
      event: '"autoscaler_update"'
      environment: string
      autoscaler: string  # Autoscaler name
      migType: string
      latencyMs: number
      minReplicas: number  # Attempted min
      maxReplicas: number  # Attempted max
      retryCount: number
      error: string  # Error message
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.event="autoscaler_update"
      jsonPayload.wafGroup="api"  # Filter by WAF group
      severity="ERROR"
    file: src/controller/observability.ts:222-236

  - event: autoscaler_not_ready
    severity: WARN
    message_pattern: "Autoscaler not ready: {name}. {error}"
    fields:
      wafGroup: string  # auto-included via child logger
      message: string
      logMetric: '"mig-manager-autoscaler-not-ready"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="mig-manager-autoscaler-not-ready"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-manager.ts:336-339

  - event: autoscaler_update_error
    severity: ERROR
    message_pattern: "Error updating autoscaler: {name}. {error}"
    fields:
      wafGroup: string  # auto-included via child logger
      message: string
      logMetric: '"mig-manager-update-error"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="mig-manager-update-error"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-manager.ts:341-344

  # ---------------------------------------------------------------------------
  # Partial Scaling Failure (some MIGs succeeded, some failed)
  # ---------------------------------------------------------------------------
  - event: partial_scaling_failure
    severity: ERROR
    message_pattern: "Partial scaling failure - capacity may be unbalanced"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"Partial scaling failure - capacity may be unbalanced"'
      logMetric: '"mig-manager-partial-failure"'
      failedMigs: string[]  # MIG types that failed
      successfulMigs: string[]  # MIG types that succeeded
      decision:
        standard: number
        spot1: number
        spot2: number
        spot3: number
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="mig-manager-partial-failure"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-manager.ts:154-167

  # ---------------------------------------------------------------------------
  # Max Retries Exceeded
  # ---------------------------------------------------------------------------
  - event: max_retries_exceeded
    severity: ERROR
    message_pattern: "Max retry attempts exceeded for autoscaler updates"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"Max retry attempts exceeded for autoscaler updates"'
      logMetric: '"mig-manager-max-retries-exceeded"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="mig-manager-max-retries-exceeded"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-manager.ts:369-372

  # ---------------------------------------------------------------------------
  # Cold Start Events
  # ---------------------------------------------------------------------------
  - event: cold_start_entry
    severity: WARN
    message_pattern: "Cold start: using only reported metrics (no fallback for unreporting instances)"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"Cold start: using only reported metrics (no fallback for unreporting instances)"'
      instancesWithMetrics: number
      instancesWithoutMetrics: number
      coverage: number  # Percentage of instances reporting (< 50%)
      logMetric: '"metrics-collector-cold-start"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="metrics-collector-cold-start"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/metrics-collector.ts:353-362

  - event: cold_start_exit
    severity: INFO
    message_pattern: "Exited cold start: sufficient instances reporting metrics"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"Exited cold start: sufficient instances reporting metrics"'
      instancesWithMetrics: number
      healthyInstances: number
      coverage: number  # Now >= 50%
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.message="Exited cold start: sufficient instances reporting metrics"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/metrics-collector.ts:368-374

  - event: mig_manager_cold_start_block
    severity: WARN
    message_pattern: "Cold start mode: blocking downscale operations, only allowing scale up"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"Cold start mode: blocking downscale operations, only allowing scale up"'
      logMetric: '"mig-manager-cold-start-block"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="mig-manager-cold-start-block"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-manager.ts:65-70

  # ---------------------------------------------------------------------------
  # Metrics Collection Errors
  # ---------------------------------------------------------------------------
  - event: mig_fetch_error
    severity: WARN
    message_pattern: "Some MIG instance fetches failed"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"Some MIG instance fetches failed"'
      failedMigs: string[]
      logMetric: '"metrics-collector-mig-fetch-error"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="metrics-collector-mig-fetch-error"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/metrics-collector.ts:76-82

  - event: lb_rps_cached
    severity: WARN
    message_pattern: "Using cached LB RPS due to API error"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"Using cached LB RPS due to API error"'
      cachedRps: number
      stalenessMs: number
      logMetric: '"metrics-collector-lb-rps-cached"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="metrics-collector-lb-rps-cached"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/metrics-collector.ts:249-255

  - event: lb_rps_unavailable
    severity: WARN
    message_pattern: "No cached LB RPS available, defaulting to 0"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"No cached LB RPS available, defaulting to 0"'
      lastCacheAgeMs: number
      logMetric: '"metrics-collector-lb-rps-unavailable"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="metrics-collector-lb-rps-unavailable"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/metrics-collector.ts:259-264

  - event: no_instance_metrics
    severity: ERROR
    message_pattern: "No instance metrics available, estimating CPU from load balancer RPS"
    fields:
      wafGroup: string  # auto-included via child logger
      message: '"No instance metrics available, estimating CPU from load balancer RPS"'
      healthyInstances: number
      loadBalancerRps: number
      estimatedCpuPerInstance: number
      logMetric: '"metrics-collector-no-instance-metrics"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="metrics-collector-no-instance-metrics"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/metrics-collector.ts:396-402

  # ---------------------------------------------------------------------------
  # Validation Errors
  # ---------------------------------------------------------------------------
  - event: validation_error
    severity: ERROR
    message_pattern: "Autoscaler {name} min {value} exceeds max {max}"
    fields:
      wafGroup: string  # auto-included via child logger
      logMetric: '"mig-manager-validation-error"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.logMetric="mig-manager-validation-error"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/mig-manager.ts:316

  # ---------------------------------------------------------------------------
  # Zone Exhaustion Monitor Errors (wafGroup included when determinable)
  # ---------------------------------------------------------------------------
  - event: unexpected_log_format
    severity: ERROR
    message_pattern: "Unexpected compute.instances.insert log format - review zone exhaustion monitor"
    fields:
      wafGroup: string  # Included if parseable from resourceName (may be null)
      migType: string  # Included if parseable from resourceName (may be null)
      event: '"unexpected_log_format"'
      insertId: string
      severity: string
      hasProtoPayload: boolean
      hasStatus: boolean
      statusMessage: string
      statusCode: number
      resourceName: string
      logMetric: '"zone-monitor-unexpected-log"'
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      jsonPayload.event="unexpected_log_format"
      jsonPayload.wafGroup="api"  # Filter by WAF group (if available)
    file: src/controller/zone-exhaustion-monitor.ts:221-238

  - event: zone_determination_failed_exhaustion
    severity: WARN
    message_pattern: "Could not determine zone from exhaustion event"
    fields:
      wafGroup: string  # Explicitly included from parseResult
      migType: string  # Explicitly included from parseResult
      entry: object  # Full log entry for debugging
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      textPayload:"Could not determine zone from exhaustion event"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/zone-exhaustion-monitor.ts:277

  - event: zone_determination_failed_success
    severity: DEBUG
    message_pattern: "Could not determine zone from success event"
    fields:
      wafGroup: string  # Explicitly included from parseResult
      migType: string  # Explicitly included from parseResult
      entry: object  # Full log entry for debugging
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      textPayload:"Could not determine zone from success event"
      jsonPayload.wafGroup="api"  # Filter by WAF group
    file: src/controller/zone-exhaustion-monitor.ts:308

  - event: zone_monitor_stream_failed
    severity: ERROR
    message_pattern: "Zone exhaustion log stream failed after multiple retries"
    note: "Project-wide event - no wafGroup (monitors all WAF groups)"
    fields:
      error: object
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      textPayload:"Zone exhaustion log stream failed"
    file: src/controller/zone-exhaustion-monitor.ts:319

  # ---------------------------------------------------------------------------
  # Project-Wide Events (no wafGroup - infrastructure level)
  # ---------------------------------------------------------------------------
  - event: zone_monitor_initialized
    severity: INFO
    message_pattern: "Initializing zone exhaustion monitor (watching instance inserts)"
    note: "Project-wide event - no wafGroup"
    fields:
      filter: string  # Cloud Logging filter used
      projectId: string
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      textPayload:"Initializing zone exhaustion monitor"
    file: src/controller/zone-exhaustion-monitor.ts:169

  - event: zone_monitor_disposed
    severity: INFO
    message_pattern: "Zone exhaustion monitor disposed"
    note: "Project-wide event - no wafGroup"
    cloud_logging_filter: |
      resource.type="cloud_run_revision"
      textPayload:"Zone exhaustion monitor disposed"
    file: src/controller/zone-exhaustion-monitor.ts:392

# ============================================================================
# Cloud Logging Query Examples (for SRE Dashboard)
# ============================================================================

cloud_logging_queries:
  # ---------------------------------------------------------------------------
  # Filter by WAF Group (MOST USEFUL)
  # ---------------------------------------------------------------------------
  all_logs_by_waf_group: |
    resource.type="cloud_run_revision"
    jsonPayload.wafGroup="api"

  all_errors_by_waf_group: |
    resource.type="cloud_run_revision"
    jsonPayload.wafGroup="api"
    severity>="ERROR"

  all_warnings_by_waf_group: |
    resource.type="cloud_run_revision"
    jsonPayload.wafGroup="api"
    severity>="WARNING"

  # ---------------------------------------------------------------------------
  # Scaling Decisions
  # ---------------------------------------------------------------------------
  scaling_decisions_by_group: |
    resource.type="cloud_run_revision"
    jsonPayload.event="scaling_decision"
    jsonPayload.wafGroup="api"

  scaling_with_gaps: |
    resource.type="cloud_run_revision"
    jsonPayload.event="scaling_decision"
    jsonPayload.wafGroup="api"
    jsonPayload.instanceGap > 0

  scaling_with_preemptions: |
    resource.type="cloud_run_revision"
    jsonPayload.event="scaling_decision"
    jsonPayload.wafGroup="api"
    jsonPayload.recentPreemptions > 0

  scaling_with_spot_boost: |
    resource.type="cloud_run_revision"
    jsonPayload.event="scaling_decision"
    jsonPayload.wafGroup="api"
    jsonPayload.standardBoost > 0

  # ---------------------------------------------------------------------------
  # Errors and Failures
  # ---------------------------------------------------------------------------
  all_errors: |
    resource.type="cloud_run_revision"
    severity="ERROR"
    labels."run.googleapis.com/service_name"="waf-controller"

  autoscaler_failures: |
    resource.type="cloud_run_revision"
    jsonPayload.wafGroup="api"
    (jsonPayload.logMetric="mig-manager-update-error" OR
     jsonPayload.logMetric="mig-manager-autoscaler-not-ready" OR
     jsonPayload.logMetric="mig-manager-max-retries-exceeded")

  partial_failures: |
    resource.type="cloud_run_revision"
    jsonPayload.logMetric="mig-manager-partial-failure"
    jsonPayload.wafGroup="api"

  # ---------------------------------------------------------------------------
  # Capacity Issues
  # ---------------------------------------------------------------------------
  zone_exhaustion: |
    resource.type="cloud_run_revision"
    jsonPayload.event="zone_exhausted"
    jsonPayload.wafGroup="api"

  instance_gap_alerts: |
    resource.type="cloud_run_revision"
    jsonPayload.event="instance_gap_alert"
    jsonPayload.wafGroup="api"

  # ---------------------------------------------------------------------------
  # Preemption Events
  # ---------------------------------------------------------------------------
  preemptions: |
    resource.type="cloud_run_revision"
    jsonPayload.message="Preemption notice"
    jsonPayload.wafGroup="api"

  preemption_storm: |
    resource.type="cloud_run_revision"
    jsonPayload.message="Preemption notice"
    jsonPayload.wafGroup="api"
    timestamp>="2024-01-01T00:00:00Z"  # Adjust window

  # ---------------------------------------------------------------------------
  # Cold Start Events
  # ---------------------------------------------------------------------------
  cold_start: |
    resource.type="cloud_run_revision"
    jsonPayload.wafGroup="api"
    (jsonPayload.logMetric="metrics-collector-cold-start" OR
     jsonPayload.logMetric="mig-manager-cold-start-block")

  # ---------------------------------------------------------------------------
  # Metrics Collection Issues
  # ---------------------------------------------------------------------------
  metrics_issues: |
    resource.type="cloud_run_revision"
    jsonPayload.wafGroup="api"
    (jsonPayload.logMetric="metrics-collector-mig-fetch-error" OR
     jsonPayload.logMetric="metrics-collector-lb-rps-cached" OR
     jsonPayload.logMetric="metrics-collector-lb-rps-unavailable" OR
     jsonPayload.logMetric="metrics-collector-no-instance-metrics")

  # ---------------------------------------------------------------------------
  # Cross-WAF Group Queries
  # ---------------------------------------------------------------------------
  all_scaling_decisions: |
    resource.type="cloud_run_revision"
    jsonPayload.event="scaling_decision"

  all_instance_gaps: |
    resource.type="cloud_run_revision"
    jsonPayload.event="instance_gap_alert"

  all_zone_exhaustion: |
    resource.type="cloud_run_revision"
    jsonPayload.event="zone_exhausted"

  all_preemptions: |
    resource.type="cloud_run_revision"
    jsonPayload.message="Preemption notice"

# ============================================================================
# Alert Conditions for SRE
# ============================================================================

alert_conditions:
  critical:
    - name: max_retries_exceeded
      description: Autoscaler updates failing persistently (5 consecutive failures)
      filter: |
        jsonPayload.logMetric="mig-manager-max-retries-exceeded"
        jsonPayload.wafGroup="api"  # Create one alert per WAF group
      action: Page on-call - scaling is broken

    - name: partial_scaling_failure
      description: Some MIGs scaled successfully but others failed (capacity imbalance)
      filter: |
        jsonPayload.logMetric="mig-manager-partial-failure"
        jsonPayload.wafGroup="api"  # Create one alert per WAF group
      action: Investigate immediately - may have unbalanced capacity

    - name: no_instance_metrics
      description: No WAF instances reporting metrics (blind scaling)
      filter: |
        jsonPayload.logMetric="metrics-collector-no-instance-metrics"
        jsonPayload.wafGroup="api"  # Create one alert per WAF group
      action: Check WAF instances health and /metrics endpoint

    - name: zone_monitor_stream_failed
      description: Zone exhaustion monitoring is blind
      filter: textPayload:"Zone exhaustion log stream failed"
      action: Check Cloud Logging stream quotas

  warning:
    - name: instance_gap_alert
      description: Capacity shortfall > 60s and > 10% of target
      filter: |
        jsonPayload.event="instance_gap_alert"
        jsonPayload.wafGroup="api"  # Create one alert per WAF group
      action: Investigate why instances aren't coming up

    - name: autoscaler_not_ready
      description: GCP autoscaler in pending state
      filter: |
        jsonPayload.logMetric="mig-manager-autoscaler-not-ready"
        jsonPayload.wafGroup="api"  # Create one alert per WAF group
      action: Check GCP Console for autoscaler status

    - name: zone_exhaustion_storm
      description: Multiple zones exhausted for same MIG type
      filter: |
        jsonPayload.event="zone_exhausted"
        jsonPayload.wafGroup="api"  # Create one alert per WAF group
      window: 5 minutes, count > 3
      action: May need to shift to standard instances

    - name: preemption_storm
      description: High preemption rate indicating spot market volatility
      filter: |
        jsonPayload.message="Preemption notice"
        jsonPayload.wafGroup="api"  # Create one alert per WAF group
      window: 5 minutes, count > 10
      action: Monitor standard boost activation

    - name: cold_start_prolonged
      description: System stuck in cold start mode
      filter: |
        jsonPayload.logMetric="mig-manager-cold-start-block"
        jsonPayload.wafGroup="api"  # Create one alert per WAF group
      window: 5 minutes, repeated
      action: Check why instances aren't reporting metrics

  informational:
    - name: scaling_decision
      description: Normal scaling operation
      filter: jsonPayload.event="scaling_decision"
      use_for: Dashboards, debugging

    - name: zone_state_changes
      description: Zone availability changes
      filter: jsonPayload.event IN ("zone_exhausted", "zone_success")
      use_for: Capacity planning

# ============================================================================
# Diagnostic Questions This Instrumentation Can Answer
# ============================================================================

diagnostic_capabilities:
  why_scaling_happened:
    query: |
      jsonPayload.event="scaling_decision"
      jsonPayload.wafGroup="api"
    look_at:
      - wafGroup (which service)
      - currentCpu vs targetCpuUtilisation
      - predictedCpu (for predictive scaling)
      - reason field (human readable)
      - instanceGap (if catching up from gap)
      - recentPreemptions (preemption-driven scaling)
      - standardBoost (spot degradation compensation)

  why_scaling_didnt_happen:
    query: |
      jsonPayload.event="scaling_decision"
      jsonPayload.wafGroup="api"
    look_at:
      - cpuHistoryLength (insufficient data)
      - healthyInstances (no instances to measure)
      - inColdStart (blocking downscale)
      - Check for autoscaler_update errors

  backend_timeout_root_causes:
    queries:
      - jsonPayload.event="instance_gap_alert" AND jsonPayload.wafGroup="api"
      - jsonPayload.event="scaling_decision" AND jsonPayload.instanceGap > 0 AND jsonPayload.wafGroup="api"
      - jsonPayload.event="zone_exhausted" AND jsonPayload.wafGroup="api"
      - jsonPayload.message="Preemption notice" AND jsonPayload.wafGroup="api"
    correlation: Match timestamps with backend timeout alerts

  capacity_exhaustion:
    queries:
      - jsonPayload.event="zone_exhausted" AND jsonPayload.wafGroup="api"
      - jsonPayload.migHealthScores.averageSpotHealth < 0.5 AND jsonPayload.wafGroup="api"
      - jsonPayload.standardBoost > 0 AND jsonPayload.wafGroup="api"
    look_at: Which zones, which MIG types, when

  preemption_analysis:
    query: |
      jsonPayload.message="Preemption notice"
      jsonPayload.wafGroup="api"
    look_at:
      - wafGroup (which service affected)
      - zone distribution
      - machineType
      - ageBucket (VM age at preemption)
      - Time patterns (cluster at same time?)

  mig_health_issues:
    queries:
      - jsonPayload.logMetric="mig-manager-update-error" AND jsonPayload.wafGroup="api"
      - jsonPayload.logMetric="mig-manager-autoscaler-not-ready" AND jsonPayload.wafGroup="api"
      - jsonPayload.logMetric="mig-manager-partial-failure" AND jsonPayload.wafGroup="api"
    look_at: Which MIG, what error, retry count

  compare_waf_groups:
    description: Compare behavior across WAF groups
    queries:
      - jsonPayload.event="scaling_decision" | Group by wafGroup
      - jsonPayload.event="instance_gap_alert" | Group by wafGroup
      - jsonPayload.message="Preemption notice" | Group by wafGroup
    use_for: Identify if issues are service-specific or platform-wide
