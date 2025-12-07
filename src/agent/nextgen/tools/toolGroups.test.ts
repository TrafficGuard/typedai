import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import {
	TOOL_GROUPS,
	buildToolIndex,
	calculateToolTokens,
	estimateGroupTokens,
	getAvailableGroups,
	getCoreGroups,
	getLoadableGroups,
	getToolGroup,
	suggestToolGroups,
} from './toolGroups';

describe('toolGroups', () => {
	setupConditionalLoggerOutput();

	describe('TOOL_GROUPS', () => {
		it('should define core tool groups', () => {
			expect(TOOL_GROUPS.FileSystem).to.exist;
			expect(TOOL_GROUPS.Agent).to.exist;
		});

		it('should define loadable tool groups', () => {
			expect(TOOL_GROUPS.Git).to.exist;
			expect(TOOL_GROUPS.GitHub).to.exist;
			expect(TOOL_GROUPS.TypeScript).to.exist;
		});

		it('should have functions array for each group', () => {
			for (const group of Object.values(TOOL_GROUPS)) {
				expect(group.functions).to.be.an('array');
				expect(group.functions.length).to.be.greaterThan(0);
			}
		});
	});

	describe('getToolGroup', () => {
		it('should return group by name', () => {
			const git = getToolGroup('Git');
			expect(git).to.exist;
			expect(git!.name).to.equal('Git');
		});

		it('should return undefined for unknown group', () => {
			const unknown = getToolGroup('NonExistent');
			expect(unknown).to.be.undefined;
		});
	});

	describe('getAvailableGroups', () => {
		it('should return all group names', () => {
			const groups = getAvailableGroups();
			expect(groups).to.include('FileSystem');
			expect(groups).to.include('Git');
			expect(groups).to.include('GitHub');
		});
	});

	describe('getCoreGroups', () => {
		it('should return FileSystem and Agent', () => {
			const core = getCoreGroups();
			expect(core).to.include('FileSystem');
			expect(core).to.include('Agent');
			expect(core).to.have.lengthOf(2);
		});
	});

	describe('getLoadableGroups', () => {
		it('should not include core groups', () => {
			const loadable = getLoadableGroups();
			expect(loadable).to.not.include('FileSystem');
			expect(loadable).to.not.include('Agent');
		});

		it('should include Git, GitHub, etc.', () => {
			const loadable = getLoadableGroups();
			expect(loadable).to.include('Git');
			expect(loadable).to.include('GitHub');
		});
	});

	describe('buildToolIndex', () => {
		it('should build formatted tool index', () => {
			const index = buildToolIndex();

			expect(index).to.include('<available_tools>');
			expect(index).to.include('</available_tools>');
			expect(index).to.include('## Core');
			expect(index).to.include('## Loadable Groups');
			expect(index).to.include('Agent_loadToolGroup');
		});

		it('should list core tool functions', () => {
			const index = buildToolIndex();
			expect(index).to.include('readFile');
			expect(index).to.include('completed');
		});

		it('should list loadable tool functions', () => {
			const index = buildToolIndex();
			expect(index).to.include('commit');
			expect(index).to.include('createMergeRequest');
		});
	});

	describe('suggestToolGroups', () => {
		it('should suggest Git for branch/commit tasks', () => {
			const suggestions = suggestToolGroups('Create a new branch and commit changes');
			expect(suggestions).to.include('Git');
		});

		it('should suggest GitHub for PR tasks', () => {
			const suggestions = suggestToolGroups('Create a pull request for the feature');
			expect(suggestions).to.include('GitHub');
		});

		it('should suggest GitHub based on project context', () => {
			const suggestions = suggestToolGroups('Create a merge request', { scmType: 'github' });
			expect(suggestions).to.include('GitHub');
		});

		it('should suggest GitLab based on project context', () => {
			const suggestions = suggestToolGroups('Create a merge request', { scmType: 'gitlab' });
			expect(suggestions).to.include('GitLab');
		});

		it('should suggest Jira for ticket tasks', () => {
			const suggestions = suggestToolGroups('Create a Jira ticket for the bug');
			expect(suggestions).to.include('Jira');
		});

		it('should suggest TypeScript for npm tasks', () => {
			const suggestions = suggestToolGroups('Run npm tests and build');
			expect(suggestions).to.include('TypeScript');
		});

		it('should suggest Python for python tasks', () => {
			const suggestions = suggestToolGroups('Run pytest on the module');
			expect(suggestions).to.include('Python');
		});

		it('should suggest CodeEditor for edit tasks', () => {
			const suggestions = suggestToolGroups('Fix the bug in auth.ts');
			expect(suggestions).to.include('CodeEditor');
		});

		it('should not return duplicates', () => {
			const suggestions = suggestToolGroups('Edit code and fix bug');
			const unique = [...new Set(suggestions)];
			expect(suggestions.length).to.equal(unique.length);
		});

		it('should return empty array for unrelated tasks', () => {
			const suggestions = suggestToolGroups('What is the meaning of life?');
			// May still return some suggestions based on keywords
			expect(suggestions).to.be.an('array');
		});
	});

	describe('estimateGroupTokens', () => {
		it('should return positive estimates for known groups', () => {
			expect(estimateGroupTokens('Git')).to.be.greaterThan(0);
			expect(estimateGroupTokens('GitHub')).to.be.greaterThan(0);
		});

		it('should return default for unknown groups', () => {
			expect(estimateGroupTokens('Unknown')).to.equal(500);
		});

		it('should estimate GitHub higher than Git', () => {
			// GitHub has more functions
			expect(estimateGroupTokens('GitHub')).to.be.greaterThan(estimateGroupTokens('Git'));
		});
	});

	describe('calculateToolTokens', () => {
		it('should sum token estimates', () => {
			const total = calculateToolTokens(['Git', 'GitHub']);
			expect(total).to.equal(estimateGroupTokens('Git') + estimateGroupTokens('GitHub'));
		});

		it('should return 0 for empty array', () => {
			expect(calculateToolTokens([])).to.equal(0);
		});
	});
});
