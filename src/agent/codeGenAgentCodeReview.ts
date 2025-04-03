import { llms } from '#agent/agentContextLocalStorage';
import { removePythonMarkdownWrapper } from '#agent/codeGenAgentUtils';
import { extractTag } from '#llm/responseParsers';

export async function reviewPythonCode(agentPlanResponse: string, functionsXml: string): Promise<string> {
	const prompt = `${functionsXml}

Your task is to review the code provided to ensure it follows the following instructions:
- The built-in packages json, re, math and datetime are already imported in the script. Including additional imports is forbidden.
- await on every call to functions defined previously in the <functions> block.
- Keep the code as simple as possible. Do not manipulate the function return values unless absolutely necessary. Prefer returning the values returned from the functions directly.
- Add comments with your reasoning.
- Add print calls throughout your code
- If defining new variables then add typings from the value being assigned.
- If you save a variable to memory then do not return it.
- You don't need to re-save existing memory values
- Always code defensively, checking values are the type and format as expected. You can assume the objects returns from function calls match the type hints
- For any operation involving user-specified items, refer to 'Interpreting User Requests' items to code defensively, ensuring flexible and context-aware handling.
- The script should return a Dict with any values you want to have available to view/process next. You don't need to do everything here.
- When calling Agent_completed or AgentFeedback_requestFeedback (if available) you must directly return its result. (Ensure any required information has already been stored to memory)
- This script may be running on repositories where the source code files are TypeScript, Java, Terraform, PHP, C#, C++, Ruby etc. Do not assume Python files.
- You can directly analyze and return contents from memory tags and . If you need to analyze unstructured data then include it to a return Dict value to view in the next step.
- All maths must be done in Python code
- If calling \`json.dumps\` it must also be passed the arg cls=JsProxyEncoder. i.e. json.dumps(data, cls=JsProxyEncoder).  You can assume the JsProxyEncoder class is available in the execution environment
- Output in a comment what you know with complete confidence about a value returned from a function
- Do NOT assume anything about the structure of the results from functions, other than what the type indicates. Return values that require further analysis. Do not call \`.get()\` on an object with an Any type
- Always use positional arguments when calling functions

<current-plan>
${agentPlanResponse}
</current-plan>

First think through your review of the code in the <python-code> tags against all the review instructions, then output the updated code wrapped in <result></result> tags. If there are no changes to make then output the existing code as is in the result tags.
`;
	let response = await llms().hard.generateText(prompt, { id: 'Review agent python code', temperature: 0.8 });
	try {
		response = extractTag(response, 'result');
	} catch (e) {
		if (!response.trim().startsWith('```python')) throw e;
	}
	return removePythonMarkdownWrapper(response);
}
