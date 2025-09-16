import Pino from 'pino';
import type { AgentContext } from '#shared/agent/agent.model';
const logLevel = process.env.LOG_LEVEL || 'INFO';
// Review config at https://github.com/simenandre/pino-cloud-logging/blob/main/src/main.ts

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

// When running locally log in a human-readable format and not JSON
const transport =
	process.env.LOG_PRETTY === 'true'
		? {
				target: 'pino-pretty',
				options: {
					colorize: true,
				},
			}
		: undefined;

// const transportTargets = [];
//
// // When running locally log in a human-readable format and not JSO
// if (process.env.LOG_PRETTY === 'true') {
// 	transportTargets.push({
// 		target: 'pino-pretty',
// 		options: {
// 			colorize: true,
// 		},
// 	})
// }
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
// const transport = Pino.transport({
// 	targets: transportTargets,
// });
// const multi = pino.multistream(targets)

let logEnricherFn: ((logObj: any) => void) | undefined = undefined;

export function setLogEnricher(fn: (logObj: any) => void) {
	logEnricherFn = fn;
}

// Fields that should not be considered "custom" keys
const standardFields = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'err', 'stack_trace', 'severity', '@type']);

/**
 * Pino logger configured for a Google Cloud environment.
 */
export const logger: Pino.Logger = Pino({
	level: logLevel,
	messageKey: 'message',
	timestamp: false, // Provided by GCP log agents
	formatters: {
		level(label: string, number: number) {
			// const severity = PinoLevelToSeverityLookup[label] || PinoLevelToSeverityLookup.info;
			// const level = number;
			// return {
			//   severity: PinoLevelToSeverityLookup[label] || PinoLevelToSeverityLookup.info,
			//   level: number,
			// };

			// const pinoLevel = label as Level;
			const severity = PinoLevelToSeverityLookup[label] ?? 'INFO';
			if (reportErrors && (label === 'error' || label === 'fatal')) {
				return {
					severity,
					'@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
				};
			}
			return { severity, level: number };
		},
		log(object: any) {
			const logObject = object as { err?: Error; msg?: string };
			const stackTrace = logObject.err?.stack;
			const stackProp: any = stackTrace ? { stack_trace: stackTrace } : {};

			if (logEnricherFn) logEnricherFn(object);

			// Custom logic to append object keys to message eg [key1, key2] so a viewer of the logs knows what additional information was logged
			if (logObject.msg) {
				// Find custom keys that were passed in the logging object
				const customKeys = Object.keys(logObject).filter((key) => !standardFields.has(key));
				// Append custom keys to the message if any exist
				if (customKeys.length > 0) logObject.msg = `${logObject.msg} [${customKeys.join(', ')}]`;
			}

			return { ...object, ...stackProp };
		},
	},
	transport,
});
