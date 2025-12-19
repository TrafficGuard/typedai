import { llms } from '#agent/agentContextUtils';
import type { FunctionJsonSchema } from '#functionSchema/functions';
import type { AgentContext } from '#shared/agent/agent.model';
import type { FunctionCall } from '#shared/llm/llm.model';

export const FUNCTION_OUTPUT_SUMMARIZE_MIN_LENGTH = 2000;
export const FUNCTION_OUTPUT_THRESHOLD = 20_000;

export const SCRIPT_RETURN_VALUE_MAX_TOKENS = 30000;

/**
 * Summarises long output functions to minimize token usage in the agents function call history
 * @param agent
 * @param agentPlanResponse
 * @param schema
 * @param parameters
 * @param output
 */
export async function summarizeFunctionOutput(
	agent: AgentContext,
	agentPlanResponse: string,
	schema: FunctionJsonSchema,
	parameters: Record<string, any>,
	output: string,
): Promise<string> {
	return await llms().medium.generateText(
		`${agentPlanResponse}
Memory keys: ${Object.keys(agent.memory).join()}
Function call history: ${agent.functionCallHistory.map((call) => call.function_name)}

Your task is to summarise the output of a function call to reduce token usage for the LLM which is executing this plan.
Function name: ${schema.name}
Function parameters: ${JSON.stringify(parameters)}
<function-ouput>
${output}
</function-ouput>

Respond only with an extensive summary of the output that will be included in the function call history of the agent. Incude all key details, which may include snippets of the original output, particularly the very start and end, identifiers, structure, etc.
The summary may be up to ${(FUNCTION_OUTPUT_THRESHOLD / 6).toFixed(0)} words long`,
		{ id: 'Summarize function output' },
	);
}

/**
 * @deprecated use summarizeFunctionOutput
 * @param functionCall
 * @param result
 */
export async function summariseLongFunctionOutput(functionCall: FunctionCall, result: string): Promise<string | null> {
	if (!result || result.length < FUNCTION_OUTPUT_SUMMARIZE_MIN_LENGTH) return null;

	const prompt = `<function_name>${functionCall.function_name}</function_name>\n<output>\n${result}\n</output>\n
	For the above function call summarise the output into a paragraph that captures key details about the output content, which might include identifiers, content summary, content structure and examples. Only responsd with the summary`;
	return await llms().easy.generateText(prompt, { id: 'Summarise long function output' });
}
