import type { AsyncLocalStorage } from 'node:async_hooks';
/* eslint-disable semi */
import type { Span, SpanContext, Tracer } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/agent/agent.model';
import { currentUser, runWithUser } from '#user/userContext';
import { type SugaredTracer, wrapTracer } from './trace/SugaredTracer';

const _fakeSpan: Partial<Span> = {
	end: () => {},
	setAttribute: () => fakeSpan,
	setAttributes: () => fakeSpan,
	recordException: () => undefined,
	setStatus: () => fakeSpan,
	addEvent: () => fakeSpan,
	spanContext: () => ({ traceId: '' }) as SpanContext,
};

const fakeSpan = _fakeSpan as Span;

/**
 * Dummy tracer for when tracing is not enabled. As we use more trace methods we will need to fill out this stub further.
 */
const dummyTracer = {
	startSpan: () => fakeSpan,
};

let tracer: SugaredTracer | null = null;
let agentContextStorage: AsyncLocalStorage<AgentContext>;
let checkForceStopped: () => void;

/**
 * @param {Tracer} theTracer - Tracer to be set by the trace-init service
 * @param theAgentContextStorage
 * @param checkForcedStoppedFunc
 */
export function setTracer(theTracer: Tracer, theAgentContextStorage: AsyncLocalStorage<AgentContext>, checkForcedStoppedFunc: () => void = () => {}): void {
	if (theTracer) tracer = wrapTracer(theTracer);
	// Having the agentContextStorage() and checkForcedStopped () function call in this file causes a compile failure, so we need to pass in the reference to the storage.
	agentContextStorage = theAgentContextStorage;
	checkForceStopped = checkForcedStoppedFunc;
}

export function getTracer(): SugaredTracer | null {
	return tracer;
}

/**
 * Starts a new independent span. The returned span must have end() called on it.
 * Only use this if your work won’t create any sub-spans.
 * @see https://opentelemetry.io/docs/instrumentation/js/instrumentation/#create-independent-spans
 * @param spanName - The name of the span
 * @returns a new span
 */
export function startSpan(spanName: string): Span {
	checkForceStopped();
	return tracer?.startSpan(spanName) ?? <Span>(<unknown>dummyTracer.startSpan());
}

export function getActiveSpan(): Span | undefined {
	return tracer ? trace.getActiveSpan() : fakeSpan;
}

/**
 * Convenience wrapper which uses the appropriate tracer and always ends the parent span.
 * @see https://opentelemetry.io/docs/instrumentation/js/instrumentation/#create-spans
 * @param spanName - The name of the span
 * @param func - Function which performs the work in the span
 * @returns the value from work function
 */
export async function withActiveSpan<T>(spanName: string, func: (span: Span) => T): Promise<T> {
	if (!spanName) console.error(new Error(), 'spanName not provided');
	checkForceStopped();
	const functionWithCallStack = async (span: Span): Promise<T> => {
		try {
			agentContextStorage?.getStore()?.callStack?.push(spanName);
			return await func(span);
		} finally {
			agentContextStorage?.getStore()?.callStack?.pop();
		}
	};

	if (!tracer) return await functionWithCallStack(fakeSpan);
	return tracer.withActiveSpan(spanName, functionWithCallStack);
}

/**
 * Only use it if your function won’t create any sub-spans.
 * @param spanName
 * @param func
 */
export function withSpan<T>(spanName: string, func: (span: Span) => T): T {
	checkForceStopped();
	if (!tracer) return func(fakeSpan);

	return tracer.withSpan(spanName, func);
}

type SpanAttributeExtractor = number | ((...args: any) => string);
type SpanAttributeExtractors = Record<string, SpanAttributeExtractor>;

/**
 * Decorator that creates an OpenTelemetry span around a class method for tracing.
 *
 * @description
 * This decorator wraps the decorated method in a trace span, allowing automatic capture
 * of method execution data and custom attributes. It supports both synchronous and
 * asynchronous methods.
 *
 * @param attributeExtractors - An object defining span attributes to collect:
 *   - Keys represent attribute names in the span
 *   - Values can be either:
 *     - A number indicating the argument index to extract from
 *     - A function that receives all method arguments and returns the attribute value
 *
 * @param returns - Controls capturing of method return value:
 *   - If true: stores raw return value in 'return' attribute
 *   - If function: transforms return value before storing
 *   - If false/undefined: return value is not captured
 *
 * @example
 * ```typescript
 * class UserService {
 *   @span({
 *     userId: 0,                                    // Capture first argument as 'userId'
 *     payloadSize: (_, payload) => payload.length,  // Compute custom attribute. Takes the args array spread as parameters
 *     timestamp: () => Date.now()                   // Static attribute
 *   }, (user) => user.id)                           // Transform the awaited return value
 *   async processUser(userId: string, payload: Buffer): Promise<User> {
 *     // Method implementation
 *   }
 * }
 * ```
 *
 * @typeParam T - Type of the decorated method
 * @returns A decorator function that wraps the original method with tracing
 */
export function span<T extends (...args: any[]) => any>(
	attributeExtractors: Record<string, number | ((...args: Parameters<T>) => any)> = {},
	returns?: boolean | ((result: Awaited<ReturnType<T>>) => any),
) {
	// NOTE this has been copied to func() in functionDecorators.ts and modified
	// Any changes should be kept in sync
	return function spanDecorator(originalMethod: any, context: ClassMethodDecoratorContext): any {
		const functionName = String(context.name);
		return async function replacementMethod(this: any, ...args: any[]) {
			checkForceStopped();
			const userCtx = (() => {
				try {
					return currentUser();
				} catch {
					return undefined;
				}
			})();
			try {
				agentContextStorage?.getStore()?.callStack?.push(functionName);
				if (!tracer) {
					return userCtx ? await runWithUser(userCtx, () => originalMethod.call(this, ...args)) : await originalMethod.call(this, ...args);
				}
				return tracer.withActiveSpan(functionName, async (span: Span) => {
					setFunctionSpanAttributes(span, functionName, attributeExtractors, args);
					return userCtx ? await runWithUser(userCtx, () => originalMethod.call(this, ...args)) : await originalMethod.call(this, ...args);
				});
			} finally {
				agentContextStorage?.getStore()?.callStack?.pop();
			}
		};
	};
}

export function setFunctionSpanAttributes(span: Span, functionName: string, attributeExtractors, args) {
	for (const [attribute, extractor] of Object.entries(attributeExtractors)) {
		if (typeof extractor === 'number') {
			const value = args[extractor] ?? '';
			// If value is an object type, then iterate over the entries and set the attributes for primitive types
			if (typeof value === 'object') {
				for (const [key, val] of Object.entries(value)) {
					if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
						span.setAttribute(`${attribute}.${key} ${val}`, val);
					}
				}
			} else {
				span.setAttribute(attribute, value);
			}
		} else if (typeof extractor === 'function') {
			span.setAttribute(attribute, extractor(...args));
		} else {
			logger.warn(`Invalid attribute extractor for ${functionName}() attribute[${attribute}], must be a number or function`);
		}
	}
}
