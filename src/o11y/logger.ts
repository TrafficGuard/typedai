import Pino from 'pino';
const logLevel = process.env.LOG_LEVEL || 'INFO';
// Review config at https://github.com/simenandre/pino-cloud-logging/blob/main/src/main.ts

const isGoogleCloud = !!process.env.GOOGLE_CLOUD_PROJECT && (process.env.ENV_LEVEL === 'stage' || process.env.ENV_LEVEL === 'prod');

// https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#logseverity
const PinoLevelToSeverityLookup: any = {
	trace: 'DEBUG', // TODO should have a lint rule to dis-allow trace
	debug: 'DEBUG',
	info: 'INFO',
	warn: 'WARNING',
	error: 'ERROR',
	fatal: 'CRITICAL',
};

const reportErrors = process.env.REPORT_ERROR_LOGS?.toLowerCase() === 'true';

const transportTargets: any[] = [];
//
// // When running locally log in a human-readable format and not JSON
// This creates a worker thread that keeps the Node.js event loop active. Mocha scripts need the --exit flag, otherwise it waits for the event loop to drain, causing a ~5 minute hang.
if (process.env.LOG_PRETTY === 'true') {
	transportTargets.push({
		target: 'pino-pretty',
		options: {
			colorize: true,
		},
	});
}
//
// // When running locally it can be useful to have the logs sent to Cloud Logging for debugging
// // https://github.com/metcoder95/cloud-pine
// if (process.env.LOG_GCLOUD === 'true') {
// 	transportTargets.push({
// 		target: 'cloud-pine',
// 		options: {
// 			cloudLoggingOptions: {
// 				skipInit: true,
// 				sync: true,
// 			}
// 		}
// 	})
// }
//

let logEnricherFn: ((logObj: any) => void) | undefined = undefined;

export function setLogEnricher(fn: (logObj: any) => void) {
	logEnricherFn = fn;
}

// Fields that should not be considered "custom" keys
const standardFields = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'message', 'err', 'stack_trace', 'severity', '@type']);

/**
 * Pino logger configured for a Google Cloud environment.
 */
const pinoFormatters =
	transportTargets.length > 0
		? undefined
		: {
				log(obj) {
					// Add stack_trace if an error is present
					if (obj?.err) {
						const error = obj.err;
						if (error instanceof Error) {
							obj.stack_trace = error.stack;
						} else if (typeof error === 'object' && 'stack' in error && typeof error.stack === 'string') {
							obj.stack_trace = error.stack;
						}
						// Optionally remove the original err object if you don’t want it duplicated
						// delete obj.err;
					}

					if (logEnricherFn) {
						logEnricherFn(obj);
					}
					return obj;
				},
				level(label: string, number: number) {
					const severity = PinoLevelToSeverityLookup[label] ?? 'INFO';
					if (reportErrors && isGoogleCloud && (label === 'error' || label === 'fatal')) {
						return {
							severity,
							'@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
						};
					}
					return { severity, level: number };
				},
			};

const pinoHooks =
	transportTargets.length > 0
		? {} // When transports are active, provide an empty hooks object
		: {
				logMethod(args, method) {
					let objIndex = -1;
					let msgIndex = -1;

					// Add custom keys to message so logs messages are like "the message [key1, key2]"

					// Identify the object and message arguments
					for (let i = 0; i < args.length; i++) {
						if (objIndex === -1 && args[i] && typeof args[i] === 'object') objIndex = i;
						if (msgIndex === -1 && typeof args[i] === 'string') msgIndex = i;
					}

					if (objIndex !== -1) {
						const obj = args[objIndex] as Record<string, unknown>;
						const customKeys = Object.keys(obj).filter((k) => !standardFields.has(k));

						if (customKeys.length > 0) {
							const suffix = ` [${customKeys.join(', ')}]`;

							if (msgIndex !== -1) {
								// Append to existing message
								args[msgIndex] = `${args[msgIndex]}${suffix}`;
							} else {
								// No message was provided; create one
								args.push(suffix);
							}
						}
					}

					// Call the original logging method with modified arguments
					return method.apply(this, args);
				},
			};

export const logger: Pino.Logger = Pino({
	level: logLevel,
	messageKey: isGoogleCloud ? 'message' : 'msg',
	timestamp: !isGoogleCloud, // Provided by GCP log agents
	formatters: pinoFormatters,
	hooks: pinoHooks,
	transport: transportTargets.length > 0 ? { targets: transportTargets } : undefined,
});
