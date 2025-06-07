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

let agentContextFn: () => AgentContext;

async function load() {
	// const agentContextLocalStorageModule = await import('#agent/agentContextLocalStorage.js');
	// // const { agentContext } = await import('#agent/agentContextLocalStorage');
	// // agentContextFn = agentContext
	// agentContextFn = agentContextLocalStorageModule.agentContext
	// console.log('Dynamically loaded agentContextLocalStorage.agentContent()')
}
load().catch(console.error);

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
			const logObject = object as { err?: Error };
			const stackTrace = logObject.err?.stack;
			const stackProp: any = stackTrace ? { stack_trace: stackTrace } : {};

			if (agentContextFn) {
				const agent = agentContextFn();
				if (agent) {
					object.agentId = agent.agentId;
					if (agent.parentAgentId) object.parentAgentId = agent.parentAgentId;
				}
			}

			return { ...object, ...stackProp };
		},
	},
	transport,
});
