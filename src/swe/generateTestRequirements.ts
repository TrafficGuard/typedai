import { llms } from '#agent/agentContextLocalStorage';
import { buildPrompt } from '#swe/prompt';

// work in progress
export async function getTestRequirements(requirements: string, implementationRequirements: string, branchDiff: string) {
	const prompt = buildPrompt({
		information: `<git-branch-diff>branchDiff</git-branch-diff><user-requirements>${requirements}</user-requirements>\n<implementation-requirements>${implementationRequirements}</implementation-requirements>\n`,
		requirements: 'Generate requirements for the creating/updating of tests to cover behaviours added/changed by the implementation requirements',
		action: '',
	});

	return llms().hard.generateJson(
		'You are an experienced software engineer with an eye for detail and robust software engineering practices, design and styles',
		prompt,
		{ id: 'reviewChanges' },
	);
}
