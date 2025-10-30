import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { DiagConsoleLogger, DiagLogLevel, type Span, diag, trace } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { FastifyInstrumentation, type FastifyRequestInfo } from '@opentelemetry/instrumentation-fastify';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import * as opentelemetry from '@opentelemetry/sdk-node';
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { setTracer } from '#o11y/trace';
import { PinoInstrumentation } from './instrumentation';

let initialized = false;
let optelNodeSdk: opentelemetry.NodeSDK;
let exporter: TraceExporter;

export function getServiceName(): string | undefined {
	return process.env.TRACE_SERVICE_NAME ?? process.env.K_SERVICE;
}

/**
 * This needs to be required/imported as early as possible in the startup sequence
 * before the modules it instruments are loaded.
 *
 * It's important to use console logging here, and any imported modules, and not
 * import the logging module, otherwise the logger instance won't be instrumented.
 *
 * https://opentelemetry.io/docs/instrumentation/js/getting-started/nodejs/
 * https://cloud.google.com/trace/docs/setup/nodejs-ot
 */
function initTrace(): void {
	if (initialized) return;
	initialized = true;

	const enabled = process.env.TRACE_AGENT_ENABLED?.toLowerCase() === 'true';
	if (enabled) {
		const logLevel =
			process.env.TRACE_LOG_LEVEL && Object.values(DiagLogLevel).includes(Number.parseInt(process.env.TRACE_LOG_LEVEL))
				? Number.parseInt(process.env.TRACE_LOG_LEVEL)
				: DiagLogLevel.ERROR;
		diag.setLogger(new DiagConsoleLogger(), logLevel);

		// For Cloud Run we'll look up the service name from K_SERVICE
		const traceServiceName = process.env.TRACE_SERVICE_NAME ?? process.env.K_SERVICE;
		if (!traceServiceName) {
			throw new Error('Environment variable TRACE_SERVICE_NAME is not set');
		}

		const autoInstrument = process.env.TRACE_AUTO_INSTRUMENT?.toLowerCase() === 'true';

		// Sample rate: Defaults to 1% of all requests
		const sampleRate = process.env.TRACE_SAMPLE_RATE ? Number.parseFloat(process.env.TRACE_SAMPLE_RATE) : 0.01;
		const sampler = new TraceIdRatioBasedSampler(sampleRate);
		// Initialize the exporter. When your application is running on Google Cloud,
		// you don't need to provide auth credentials or a project id.
		const exporterOpts = process.env.NODE_ENV === 'development' ? { projectId: process.env.PROJECT } : {};
		exporter = new TraceExporter(exporterOpts);

		// const provider = new NodeTracerProvider();
		// provider.register();
		optelNodeSdk = new opentelemetry.NodeSDK({
			resource: new Resource({
				[SemanticResourceAttributes.SERVICE_NAME]: traceServiceName,
			}),
			traceExporter: exporter,
			sampler: sampler,
			instrumentations: autoInstrument
				? [getNodeAutoInstrumentations()]
				: [
						new PinoInstrumentation({
							// Optional hook to insert additional context to log object.
							// logHook: (_span, record, _level) => {
							// record['resource.service.name'] = 'bq-slots';
							// },
							// Log span context under custom keys
							// This is optional, and will default to "trace_id", "span_id" and "trace_flags" as the keys
							logKeys: {
								traceId: 'traceId',
								spanId: 'spanId',
								traceFlags: 'traceFlags',
							},
						}),
						// Fastify instrumentation expects HTTP layer to be instrumented
						new HttpInstrumentation(),
						new FastifyInstrumentation({
							requestHook: (span: Span, _info: FastifyRequestInfo) => {
								span.setAttribute('test', 'foo');
							},
						}),
					],
		});

		// initialize the SDK and register with the OpenTelemetry API
		// this enables the API to record telemetry
		// If we still have issues with modules loading before being instrumentation is ready then we
		// would need to start the server in the then() callback like in https://lightstep.com/blog/opentelemetry-nodejs
		optelNodeSdk.start();

		// gracefully shut down the SDK on process exit
		process.on('SIGTERM', () => {
			optelNodeSdk.shutdown().catch((error: unknown) => console.warn('Error terminating tracing %o', error));
		});

		const tracer = trace.getTracer(traceServiceName);
		setTracer(tracer);
	} else {
		setTracer(null);
	}
}

export async function shutdownTrace(): Promise<void> {
	try {
		await optelNodeSdk?.shutdown();
		await exporter?.shutdown();
	} catch (error) {
		console.error('Error shutting down trace:', error.message);
	}
}

initTrace();
