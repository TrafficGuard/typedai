import { llms } from '#agent/agentContextLocalStorage';
import { removePythonMarkdownWrapper } from '#agent/autonomous/codegen/pythonCodeGenUtils';
import { extractTag } from '#llm/responseParsers';

export async function reviewPythonCode(agentPlanResponse: string, functionsXml: string): Promise<string> {
	const prompt = `${functionsXml}

Your task is to review the code provided to ensure it follows the following instructions:
- Assume the imports for built-in packages typing, json, re, math and datetime will be added to the start of the script. Do not include any import statements. No other packages are allowed.
- await on every call to functions defined previously in the <functions> block.
- Keep the code as simple as possible. Do not manipulate the function return values unless absolutely necessary. Prefer returning the values returned from the functions directly.
- Add comments with your reasoning.
- Add print calls throughout your code
- If defining new variables then add typings from the value being assigned.
- If you save a variable to memory then do not return it.
- You don't need to re-save existing memory values
- Always code defensively, checking values are the type and format as expected. Assume the objects returns from function calls match the type hints
- For any operation involving user-specified items, refer to 'Interpreting User Requests' items to code defensively, ensuring flexible and context-aware handling.
- The script should return a Dict with any values you want to have available to view/process next. You don't need to do everything here.
- When calling Agent_completed or AgentFeedback_requestFeedback (if available) you must directly return its result. (Ensure any required information has already been stored to memory)
- This script may be running on repositories where the source code files are TypeScript, Java, Terraform, PHP, C#, C++, Ruby etc. Do not assume Python files.
- You can directly analyze and return contents from memory tags and . If you need to analyze unstructured data then include it to a return Dict value to view in the next step.
- All maths must be done in Python code
- If calling \`json.dumps\` it must also be passed the arg cls=JsProxyEncoder. i.e. json.dumps(data, cls=JsProxyEncoder).  Assume the JsProxyEncoder class is available in the execution environment
- Output in a comment what you know with complete confidence about a value returned from a function
- Do NOT assume anything about the structure of the results from functions, other than what the type indicates. Return values that require further analysis. Do not call \`.get()\` on an object with an Any type
- Always use positional arguments when calling functions

<current-plan>
${agentPlanResponse}
</current-plan>

First output through your review of the code in the <python-code> tags against each of the review instructions.
Then output the updated code to go in main() method wrapped in <result></result> tags without any extra indentation.
If there are no changes to make then output the existing code as is in the result tags.
`;
	let response = await llms().hard.generateText(prompt, { id: 'Review agent python code', temperature: 0.5 });
	console.log(response);
	try {
		response = extractTag(response, 'result');
	} catch (e) {
		if (!response.trim().startsWith('```python')) throw e;
	}
	return removePythonMarkdownWrapper(response);
}
