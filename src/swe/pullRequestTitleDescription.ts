import { getFileSystem, llms } from '#agent/agentContextLocalStorage';

export async function generatePullRequestTitleDescription(requirements: string, baseBranch: string): Promise<{ title: string; description: string }> {
	const pullRequestDescriptionPrompt = `<requirement>\n${requirements}\n</requirement><diff>\n${await getFileSystem()
		.getVcs()
		.getDiff(
			baseBranch,
		)}\n</diff>\nFrom these requirements and diff, generate a description for a Pull Request/Merge Request. Answer only with the description`;

	const pullRequestDescription = await llms().medium.generateText('Answer concisely', pullRequestDescriptionPrompt, { id: 'Pull request description' });

	let pullRequestTitle = await llms().medium.generateText(
		'Answer concisely',
		`<requirement>\n${requirements}\n</requirement><mr_description>\n${pullRequestDescription}\n</mr_description>\nFrom this Merge Request description, generate a title for the Merge Request. Answer only with the title.`,
		{ id: 'Pull request title' },
	);

	// Title has a maximum of 255 characters
	if (pullRequestTitle.length > 255) pullRequestTitle = pullRequestTitle.substring(0, 254);

	return {
		title: pullRequestTitle,
		description: pullRequestDescription,
	};
}
