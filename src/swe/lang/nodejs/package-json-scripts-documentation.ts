import fs from 'node:fs';
import type { LLM } from '#shared/model/llm.model';

/**
 * Generates documentation for the scripts in the package.json file, assuming it exists, in a Markdown formatted list.
  @param llm
 */
export async function documentPackageJsonScripts(llm: LLM): Promise<string> {
	if (!fs.existsSync('package.json')) {
		throw new Error('package.json does not exist');
	}

	const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
	const scripts = packageJson.scripts;

	const prompt = `Generate the documentation for following scripts from a node.js package.json file as a list in Markdown format. Don't include the script values, only the documentation description.\n${JSON.stringify(
		scripts,
		null,
		2,
	)}`;

	return llm.generateText(prompt, { id: 'documentPackageJsonScripts' });
}
