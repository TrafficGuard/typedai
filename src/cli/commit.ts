import '#fastify/trace-init/trace-init';

import { initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';

async function main() {
	await initApplicationContext();
	console.log('Commit command starting...');

	// For now, we will just print a message.
	// In the future, this will get staged changes and generate a commit message.
	console.log('TODO: Implement git diff and LLM call.');

	const { medium } = defaultLLMs();

	const gitInfo = 'Placeholder for git diff'; // TODO: Get actual git diff

	const prompt = `
Based on the following file contents and git diff, generate a conventional commit message.

<git_diff>
${gitInfo}
</git_diff>

Return the result as a JSON object with "title" and "description" keys.
`;

	const result = await medium.generateText(prompt);
	console.log(result);

	await shutdownTrace();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
