import { llms } from '#agent/agentContextLocalStorage';

export async function reviewPythonCode(agentPlanResponse: string): Promise<string> {
	const prompt = `
Your task is to review the code provided to ensure it follows the following instructions:
- The built-in packages json, re, math and datetime are already imported in the script. Including additional imports is forbidden.
- await on every call to functions defined previously in the <functions> block.
- Keep the code as simple as possible. Do not manipulate the function return values unless absolutely necessary. Prefer returning the values returned from the functions directly.
- Add comments with your reasoning.
- Add print calls throughout your code
- If defining new variables then add typings from the value being assigned.
- If you save a variable to memory then do not return it.
- You don't need to re-save existing memory values
- Always code defensively, checking values are the type and format as expected
- For any operation involving user-specified items, refer to 'Interpreting User Requests' items to code defensively, ensuring flexible and context-aware handling.
- The script should return a Dict with any values you want to have available to view/process next. You don't need to do everything here.
- When calling Agent_completed or AgentFeedback_requestFeedback you must directly return its result. (Ensure any required information has already been stored to memory)
- This script may be running on repositories where the source code files are TypeScript, Java, Terraform, PHP, C#, C++, Ruby etc. Do not assume Python files.
- You can directly analyze and return contents from memory tags and . If you need to analyze unstructured data then include it to a return Dict value to view in the next step.
- All maths must be done in Python code
- If calling \`json.dumps\` it must also be passed the arg cls=JsProxyEncoder. i.e. json.dumps(data, cls=JsProxyEncoder)
- Output in a comment what you know with complete confidence about a value returned from a function
- Do NOT assume anything about the structure of the results from functions, other than what the type indicates. Return values that require further analysis. Do not call \`.get()\` on an object with an Any type

<example>
<expanded_user_request>
List all the Terraform projects available in our GitLab repository.
</expanded_user_request>
<python-code>
# Check memory contents if we have retrieved the GitLab projects in a previous step. Not found.
# Retrieve the list of all projects from GitLab
projects: List[Dict] = await GitLab_getProjects()

# Ensure projects is a list before processing
if not isinstance(projects, list):
    print("Warning: Expected a list of projects, but received a different type.")
    return {"error": "Unexpected data format from GitLab_getProjects()"}

print(f"Retrieved {len(projects)} projects from GitLab")

# Initialize a list to store potential Terraform projects
terraform_projects = []

# Analyze the projects to identify potential Terraform projects
for project in projects:
    # Check if the project name or description contains Terraform-related keywords
    if 'terraform' in project.get('name', '').lower() or 'terraform' in project.get('description', '').lower():
        terraform_projects.append(project)

print(f"Identified {len(terraform_projects)} potential Terraform projects")

# If we couldn't identify any Terraform projects, we might need more information
if not terraform_projects:
    return await AgentFeedback_requestFeedback("I couldn't identify any Terraform projects based on project names and descriptions. Do you have any additional information on how Terraform projects are typically named or organized in your GitLab repository?")

await Agent_saveMemory("potential_terraform_projects", json.dumps(potential_terraform_projects, cls=JsProxyEncoder)

# Return the list of potential Terraform projects for further analysis
return {"potential_terraform_projects": terraform_projects}
</python-code>
</user>
<assistant>
Analysis:
- The code should not assume the structure of the Dict from the results of GitLab_getProjects() and should not assume the naming conventions of the project names.
- It is not required to check that projects isinstance of list, as we can inferr that from the typings.
- The project list should be returned for full analysis.
- The code should not save a value to memory and also return it.
<result>
# Check memory contents if we have retrieved the GitLab projects in a previous step. Not found.
# Retrieve the list of all projects from GitLab
projects: List[Dict] = await GitLab_getProjects()

print(f"Retrieved {len(projects)} projects from GitLab")
# The structure and naming conventions of the projects is unknown, so return for full ananlysis
return {"gitlab_projects": projects}
</result>
</assistant>
</example>

${agentPlanResponse}

First detail your review of the code, then output the updated code wrapped in <result></result> tags. If there are no changes to make then output the existing code as is in the result tags.
`;
	return await llms().medium.generateTextWithResult(prompt, { id: 'Review agent python code', temperature: 0.8 });
}
