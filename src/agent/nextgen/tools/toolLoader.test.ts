import { expect } from 'chai';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { NextGenAgentContext } from '../core/types';
import { createMockAgentContext } from '../test/fixtures';
import { getCoreGroups } from './toolGroups';
import { ToolLoader } from './toolLoader';

describe('ToolLoader', () => {
	setupConditionalLoggerOutput();

	let toolLoader: ToolLoader;

	beforeEach(() => {
		toolLoader = new ToolLoader({ maxToolTokens: 8000 });
	});

	describe('loadGroup', () => {
		it('should load a tool group', async () => {
			const agent = createAgentWithToolState();

			const result = await toolLoader.loadGroup(agent, 'Git');

			expect(result.success).to.be.true;
			expect(result.groupName).to.equal('Git');
			expect(result.tokensAdded).to.be.greaterThan(0);
			expect(agent.toolLoadingState.activeGroups.has('Git')).to.be.true;
		});

		it('should add tool schema to message stack', async () => {
			const agent = createAgentWithToolState();

			await toolLoader.loadGroup(agent, 'Git');

			const hasGitSchema = agent.messageStack.toolSchemas.some((m) => typeof m.content === 'string' && m.content.includes('loaded_tool_group name="Git"'));
			expect(hasGitSchema).to.be.true;
		});

		it('should return success if already loaded', async () => {
			const agent = createAgentWithToolState();
			await toolLoader.loadGroup(agent, 'Git');

			const result = await toolLoader.loadGroup(agent, 'Git');

			expect(result.success).to.be.true;
			expect(result.tokensAdded).to.equal(0); // No additional tokens
		});

		it('should fail for unknown group', async () => {
			const agent = createAgentWithToolState();

			const result = await toolLoader.loadGroup(agent, 'NonExistent');

			expect(result.success).to.be.false;
			expect(result.error).to.include('Unknown tool group');
		});

		it('should track group in groupsUsedSinceLastCompaction', async () => {
			const agent = createAgentWithToolState();

			await toolLoader.loadGroup(agent, 'GitHub');

			expect(agent.toolLoadingState.groupsUsedSinceLastCompaction.has('GitHub')).to.be.true;
		});

		it('should record load time', async () => {
			const agent = createAgentWithToolState();
			const before = Date.now();

			await toolLoader.loadGroup(agent, 'Git');

			const loadTime = agent.toolLoadingState.loadedAt.get('Git');
			expect(loadTime).to.be.greaterThanOrEqual(before);
		});
	});

	describe('loadGroups', () => {
		it('should load multiple groups', async () => {
			const agent = createAgentWithToolState();

			const results = await toolLoader.loadGroups(agent, ['Git', 'GitHub']);

			expect(results).to.have.lengthOf(2);
			expect(results.every((r) => r.success)).to.be.true;
			expect(agent.toolLoadingState.activeGroups.has('Git')).to.be.true;
			expect(agent.toolLoadingState.activeGroups.has('GitHub')).to.be.true;
		});
	});

	describe('unloadGroup', () => {
		it('should unload a loaded group', async () => {
			const agent = createAgentWithToolState();
			await toolLoader.loadGroup(agent, 'Git');

			const result = toolLoader.unloadGroup(agent, 'Git');

			expect(result).to.be.true;
			expect(agent.toolLoadingState.activeGroups.has('Git')).to.be.false;
		});

		it('should return false for unloaded group', async () => {
			const agent = createAgentWithToolState();

			const result = toolLoader.unloadGroup(agent, 'Git');

			expect(result).to.be.false;
		});

		it('should not unload core groups', async () => {
			const agent = createAgentWithToolState();

			const result = toolLoader.unloadGroup(agent, 'FileSystem');

			expect(result).to.be.false;
			expect(agent.toolLoadingState.activeGroups.has('FileSystem')).to.be.true;
		});

		it('should remove schema from message stack', async () => {
			const agent = createAgentWithToolState();
			await toolLoader.loadGroup(agent, 'Git');

			toolLoader.unloadGroup(agent, 'Git');

			const hasGitSchema = agent.messageStack.toolSchemas.some((m) => typeof m.content === 'string' && m.content.includes('loaded_tool_group name="Git"'));
			expect(hasGitSchema).to.be.false;
		});
	});

	describe('unloadCompactedGroups', () => {
		it('should unload groups used since last compaction', async () => {
			const agent = createAgentWithToolState();
			await toolLoader.loadGroups(agent, ['Git', 'GitHub']);

			const unloaded = toolLoader.unloadCompactedGroups(agent);

			expect(unloaded).to.include('Git');
			expect(unloaded).to.include('GitHub');
			expect(agent.toolLoadingState.activeGroups.has('Git')).to.be.false;
		});

		it('should not unload core groups', async () => {
			const agent = createAgentWithToolState();
			agent.toolLoadingState.groupsUsedSinceLastCompaction.add('FileSystem');

			const unloaded = toolLoader.unloadCompactedGroups(agent);

			expect(unloaded).to.not.include('FileSystem');
			expect(agent.toolLoadingState.activeGroups.has('FileSystem')).to.be.true;
		});
	});

	describe('token limits', () => {
		it('should fail when exceeding token limit without auto-unload', async () => {
			const smallLoader = new ToolLoader({ maxToolTokens: 1000, autoUnload: false });
			const agent = createAgentWithToolState();

			// Try to load a large group
			const result = await smallLoader.loadGroup(agent, 'GitHub');

			expect(result.success).to.be.false;
			expect(result.error).to.include('exceed token limit');
		});

		it('should auto-unload LRU groups when limit exceeded', async () => {
			// Core groups: FileSystem(800) + Agent(600) = 1400 tokens
			// Git: 1200 tokens, GitHub: 2000 tokens
			// Set limit that allows core + one large group but not both
			const smallLoader = new ToolLoader({ maxToolTokens: 4000, autoUnload: true });
			const agent = createAgentWithToolState();

			// Load first group (Git ~1200 tokens, total ~2600)
			await smallLoader.loadGroup(agent, 'Git');
			expect(agent.toolLoadingState.activeGroups.has('Git')).to.be.true;

			// Try to load second large group (GitHub ~2000 tokens)
			// This should trigger unloading Git to make room
			const result = await smallLoader.loadGroup(agent, 'GitHub');

			// GitHub should be loaded (core groups can't be unloaded, so Git must go)
			expect(result.success).to.be.true;
			expect(agent.toolLoadingState.activeGroups.has('GitHub')).to.be.true;
			// Git should have been unloaded
			expect(agent.toolLoadingState.activeGroups.has('Git')).to.be.false;
		});
	});

	describe('getGroupSchemas', () => {
		it('should return schemas for a group', async () => {
			const schemas = await toolLoader.getGroupSchemas('Git');

			expect(schemas).to.be.an('array');
			expect(schemas.length).to.be.greaterThan(0);
			expect(schemas[0]).to.have.property('name');
			expect(schemas[0]).to.have.property('description');
		});

		it('should cache schemas', async () => {
			const schemas1 = await toolLoader.getGroupSchemas('Git');
			const schemas2 = await toolLoader.getGroupSchemas('Git');

			expect(schemas1).to.equal(schemas2); // Same reference
		});

		it('should return empty array for unknown group', async () => {
			const schemas = await toolLoader.getGroupSchemas('NonExistent');
			expect(schemas).to.have.lengthOf(0);
		});
	});

	describe('initializeToolState', () => {
		it('should return state with core groups loaded', () => {
			const state = toolLoader.initializeToolState();

			expect(state.activeGroups).to.be.instanceOf(Set);
			expect(state.activeGroups.has('FileSystem')).to.be.true;
			expect(state.activeGroups.has('Agent')).to.be.true;
		});

		it('should have empty groupsUsedSinceLastCompaction', () => {
			const state = toolLoader.initializeToolState();
			expect(state.groupsUsedSinceLastCompaction.size).to.equal(0);
		});

		it('should have load times for core groups', () => {
			const state = toolLoader.initializeToolState();
			expect(state.loadedAt.has('FileSystem')).to.be.true;
			expect(state.loadedAt.has('Agent')).to.be.true;
		});
	});

	describe('getLoadedGroups', () => {
		it('should return list of loaded groups', async () => {
			const agent = createAgentWithToolState();
			await toolLoader.loadGroup(agent, 'Git');

			const loaded = toolLoader.getLoadedGroups(agent);

			expect(loaded).to.include('FileSystem');
			expect(loaded).to.include('Agent');
			expect(loaded).to.include('Git');
		});
	});

	describe('isGroupLoaded', () => {
		it('should return true for loaded groups', async () => {
			const agent = createAgentWithToolState();
			await toolLoader.loadGroup(agent, 'Git');

			expect(toolLoader.isGroupLoaded(agent, 'Git')).to.be.true;
			expect(toolLoader.isGroupLoaded(agent, 'FileSystem')).to.be.true;
		});

		it('should return false for unloaded groups', () => {
			const agent = createAgentWithToolState();

			expect(toolLoader.isGroupLoaded(agent, 'GitHub')).to.be.false;
		});
	});

	describe('suggestGroups', () => {
		it('should suggest groups and provide hint', () => {
			const { groups, hint } = toolLoader.suggestGroups('Create a pull request');

			expect(groups).to.include('GitHub');
			expect(hint).to.include('Agent_loadToolGroup');
		});

		it('should return empty hint when no suggestions', () => {
			const { hint } = toolLoader.suggestGroups('random unrelated text xyz123');
			// May have suggestions or not based on keywords
			expect(hint).to.be.a('string');
		});
	});
});

// Helper function
function createAgentWithToolState(): NextGenAgentContext {
	const agent = createMockAgentContext();
	const loader = new ToolLoader();
	agent.toolLoadingState = loader.initializeToolState();
	return agent;
}
