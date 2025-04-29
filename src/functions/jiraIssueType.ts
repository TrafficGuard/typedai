/**
 * Determines the issue type for a jira
 */
export async function getJiraIssueType(projectKey: string, title: string, description: string, relatedContentForIssueTypeDetection?: string): Promise<string> {
	return '3'; // Task
	// Customise this for your Jira configuration
	// Example prompt:
	/*
	const prompt = `<project-key>
${projectKey}
</project-key>
<title>${title}</title>
<description>
${description}
</description>
<additional-context>${relatedContentForIssueTypeDetection ?? ''}</additional-context>

<issue-selection-instructions>
If the issue is about feature requests and the project key is ABC then the issue type is 6.
If the issue is a bug fix and the project key is ABC then the issue type is 7.
</issue-selection-instructions>

Explain your thought process selecting the appropriate issue type, then finally respond with the issue type in <result> tags.

Example response format:

<thoughts>
- The description describes a feature request and the project key is "ABC" which indicates the issue type should be 6.
</thoughts>
<result>
6
</result>`;
	return await llms().medium.generateTextWithResult(prompt);
	*/
}
