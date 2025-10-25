import '#fastify/trace-init/trace-init';

import { initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { Git } from '#functions/scm/git';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { loadCliEnvironment } from './envLoader';

async function main() {
	loadCliEnvironment();
	await initApplicationContext();
	console.log('Commit command starting...');

	const git = new Git();
	const stagedFiles = await git.getStagedFiles();

	if (stagedFiles.length === 0) {
		console.log('No staged files to commit.');
		await shutdownTrace();
		return;
	}

	let gitDiff = await git.getStagedDiff();
	if (gitDiff.length > 10000) {
		gitDiff = gitDiff.substring(0, 10000);
	}

	const fsRead = new FileSystemRead();
	const fileContentsArray = await Promise.all(stagedFiles.map((file) => fsRead.readFile(file)));

	const fileContents = stagedFiles.map((path, index) => `<file path="${path}">${fileContentsArray[index]}</file>`).join('\n');

	const { medium } = defaultLLMs();

	const prompt = `
Based on the following file contents and git diff, generate a conventional commit message.

<file_contents>
${fileContents}
</file_contents>

<git_diff>
${gitDiff}
</git_diff>

Return the result as a JSON object with "title" and "description" keys, wrapped in <json> tags.
`;

	const result = await medium.generateText(prompt);

	const jsonResult = result.match(/<json>([\s\S]*?)<\/json>/);
	if (jsonResult?.[1]) {
		const commitMessage = JSON.parse(jsonResult[1]);
		console.log('Title:', commitMessage.title);
		console.log('Description:', commitMessage.description);
	} else {
		console.log('Could not parse commit message from LLM response:');
		console.log(result);
	}

	await shutdownTrace();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
