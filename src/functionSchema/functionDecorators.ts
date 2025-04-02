import { Span } from '@opentelemetry/api';
import { agentContext } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { getTracer, setFunctionSpanAttributes, withActiveSpan } from '#o11y/trace';
import { functionSchemaParser } from './functionSchemaParser';
import { FUNC_SEP, FunctionSchema, getFunctionSchemas, setFunctionSchemas } from './functions';

let _functionFactory = {};

export function functionFactory() {
	if (_functionFactory === undefined) _functionFactory = {};
	return _functionFactory;
}

/**
 * Decorator which flags a class method to be exposed as a function for the agents.
 */
export function func() {
	// NOTE - this is similar to span() in trace.ts and modified to trace all arguments
	// Any changes should be kept in sync
	return function spanDecorator(originalMethod: any, context: ClassMethodDecoratorContext): any {
		const methodName = String(context.name);
		return async function replacementMethod(this: any, ...args: any[]) {
			const tracer = getTracer();
			const agent = agentContext();

			// TODO move agent.functionCallHistory.push from xml and codegen runners to here so agentWorkflows show the function call history
			// output summarising might have to happen in the agentService.save
			// // Convert arg array to parameters name/value map
			// const parameters: { [key: string]: any } = {};
			// for (let index = 0; index < args.length; index++) parameters[schema.parameters[index].name] = args[index];
			// agent.functionCallHistory.push({
			// 	function_name: functionCall.function_name,
			// 	parameters: functionCall.parameters,
			// 	stdout: JSON.stringify(functionResponse),
			// 	stdoutSummary: outputSummary,
			// });

			if (!tracer) {
				try {
					agent?.callStack?.push(methodName);
					return await originalMethod.call(this, ...args);
				} finally {
					agentContext()?.callStack?.pop();
				}
			}
			const className = Object.getPrototypeOf(this).constructor.name;
			const functionName = `${className}${FUNC_SEP}${methodName}`;
			// NOTE - modification, build attributeExtractors from all the arguments
			const funcDefinitions = getFunctionSchemas(this);
			let funcDef: FunctionSchema = funcDefinitions[functionName];
			if (!funcDef) {
				// Same hack in LlmFunction.ts
				funcDef = funcDefinitions[methodName];
			}
			if (!funcDef)
				throw new Error(
					`Function Error: No function schema found for ${functionName}. Does the method have JSDoc?. Valid functions are ${Object.keys(funcDefinitions)}`,
				);
			const attributeExtractors = {};
			if (funcDef.parameters === undefined) throw new Error(`No parameters defined for ${functionName}`);
			for (const param of funcDef.parameters) {
				attributeExtractors[param.name] = param.index;
			}

			return await withActiveSpan(methodName, async (span: Span) => {
				setFunctionSpanAttributes(span, methodName, attributeExtractors, args);
				span.setAttribute('call', agentContext()?.callStack?.join(' > ') ?? '');

				const result = originalMethod.call(this, ...args);
				if (typeof result?.then === 'function') await result;
				try {
					span.setAttribute('result', JSON.stringify(result));
				} catch (e) {
					logger.info(`Could not serialize result from function ${methodName}: ${e.message}`);
				}
				return result;
			});
		};
	};
}

/**
 * Decorator for classes which contain functions to make available to the LLMs.
 * This is required so ts-morph can read the source code to dynamically generate the schemas.
 * @param filename Must be __filename
 */
export function funcClass(filename: string) {
	return function ClassDecorator<C extends new (...args: any[]) => any>(target: C, _ctx: ClassDecoratorContext) {
		functionFactory()[target.name] = target;
		setFunctionSchemas(target, functionSchemaParser(filename));
		return target;
	};
}
