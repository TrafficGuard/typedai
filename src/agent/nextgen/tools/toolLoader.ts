/**
 * Tool Loader for NextGen Agent
 *
 * Manages dynamic loading and unloading of tool groups.
 * Integrates with the ContextManager for adding/removing tool schemas.
 */

import { logger } from '#o11y/logger';
import { ContextManager } from '../context/contextManager';
import type { FunctionSchema, NextGenAgentContext, ToolGroup, ToolLoadingState } from '../core/types';
import { TOOL_GROUPS, estimateGroupTokens, formatToolGroupSchemas, getCoreGroups, getToolGroup } from './toolGroups';

/**
 * Configuration for the tool loader
 */
export interface ToolLoaderConfig {
	/** Maximum total tokens for loaded tool schemas (default: 8000) */
	maxToolTokens?: number;
	/** Whether to auto-unload least recently used groups when limit exceeded (default: true) */
	autoUnload?: boolean;
}

/**
 * Result of a tool loading operation
 */
export interface LoadResult {
	success: boolean;
	groupName: string;
	tokensAdded: number;
	error?: string;
}

/**
 * Manages tool loading for NextGen agents
 */
export class ToolLoader {
	private config: Required<ToolLoaderConfig>;
	private contextManager: ContextManager;
	private schemaCache: Map<string, FunctionSchema[]> = new Map();

	constructor(config: ToolLoaderConfig = {}, contextManager?: ContextManager) {
		this.config = {
			maxToolTokens: config.maxToolTokens ?? 8000,
			autoUnload: config.autoUnload ?? true,
		};
		this.contextManager = contextManager ?? new ContextManager();
	}

	/**
	 * Loads a tool group into the agent's context
	 */
	async loadGroup(agent: NextGenAgentContext, groupName: string): Promise<LoadResult> {
		// Check if already loaded
		if (agent.toolLoadingState.activeGroups.has(groupName)) {
			logger.debug(`Tool group ${groupName} already loaded`);
			return { success: true, groupName, tokensAdded: 0 };
		}

		// Get the group definition
		const group = getToolGroup(groupName);
		if (!group) {
			return { success: false, groupName, tokensAdded: 0, error: `Unknown tool group: ${groupName}` };
		}

		// Get schemas for the group
		const schemas = await this.getGroupSchemas(groupName);
		const tokenCost = estimateGroupTokens(groupName);

		// Check token budget
		let currentToolTokens = this.calculateCurrentToolTokens(agent);
		if (currentToolTokens + tokenCost > this.config.maxToolTokens) {
			if (this.config.autoUnload) {
				// Try to unload least recently used groups to make room
				const tokensToFree = currentToolTokens + tokenCost - this.config.maxToolTokens;
				const freed = await this.unloadLRU(agent, tokensToFree);
				// Recalculate current tokens after unloading
				currentToolTokens = this.calculateCurrentToolTokens(agent);
				if (currentToolTokens + tokenCost > this.config.maxToolTokens) {
					return {
						success: false,
						groupName,
						tokensAdded: 0,
						error: `Cannot load ${groupName}: would exceed token limit (need ${tokenCost}, only freed ${freed})`,
					};
				}
			} else {
				return {
					success: false,
					groupName,
					tokensAdded: 0,
					error: `Cannot load ${groupName}: would exceed token limit of ${this.config.maxToolTokens}`,
				};
			}
		}

		// Format and add schemas to context
		const schemaContent = formatToolGroupSchemas(group, schemas);
		this.contextManager.addToolSchema(agent, groupName, schemaContent);

		logger.info(`Loaded tool group ${groupName} (~${tokenCost} tokens)`);

		return { success: true, groupName, tokensAdded: tokenCost };
	}

	/**
	 * Loads multiple tool groups
	 */
	async loadGroups(agent: NextGenAgentContext, groupNames: string[]): Promise<LoadResult[]> {
		const results: LoadResult[] = [];
		for (const name of groupNames) {
			const result = await this.loadGroup(agent, name);
			results.push(result);
		}
		return results;
	}

	/**
	 * Unloads a tool group from the agent's context
	 */
	unloadGroup(agent: NextGenAgentContext, groupName: string): boolean {
		// Prevent unloading core groups
		if (getCoreGroups().includes(groupName)) {
			logger.warn(`Cannot unload core tool group: ${groupName}`);
			return false;
		}

		if (!agent.toolLoadingState.activeGroups.has(groupName)) {
			return false;
		}

		this.contextManager.removeToolSchemas(agent, [groupName]);
		logger.debug(`Unloaded tool group ${groupName}`);
		return true;
	}

	/**
	 * Unloads tool groups that were used since last compaction
	 * Called during compaction to reset tool state
	 */
	unloadCompactedGroups(agent: NextGenAgentContext): string[] {
		const groupsToUnload = Array.from(agent.toolLoadingState.groupsUsedSinceLastCompaction).filter((g) => !getCoreGroups().includes(g));

		this.contextManager.removeToolSchemas(agent, groupsToUnload);

		logger.info(`Unloaded ${groupsToUnload.length} tool groups during compaction`);
		return groupsToUnload;
	}

	/**
	 * Gets schemas for a tool group (with caching)
	 */
	async getGroupSchemas(groupName: string): Promise<FunctionSchema[]> {
		// Check cache first
		if (this.schemaCache.has(groupName)) {
			return this.schemaCache.get(groupName)!;
		}

		const group = getToolGroup(groupName);
		if (!group) {
			return [];
		}

		// Generate schemas from function names
		// In a full implementation, this would load actual schemas from @funcClass decorators
		const schemas: FunctionSchema[] = group.functions.map((funcName) => ({
			name: `${groupName}_${funcName}`,
			description: `${funcName} function from ${groupName} tool group`,
			parameters: {},
		}));

		this.schemaCache.set(groupName, schemas);
		return schemas;
	}

	/**
	 * Initializes tool loading state for a new agent
	 */
	initializeToolState(): ToolLoadingState {
		return {
			activeGroups: new Set(getCoreGroups()),
			groupsUsedSinceLastCompaction: new Set(),
			loadedAt: new Map(getCoreGroups().map((g) => [g, Date.now()])),
		};
	}

	/**
	 * Gets currently loaded tool groups
	 */
	getLoadedGroups(agent: NextGenAgentContext): string[] {
		return Array.from(agent.toolLoadingState.activeGroups);
	}

	/**
	 * Checks if a tool group is loaded
	 */
	isGroupLoaded(agent: NextGenAgentContext, groupName: string): boolean {
		return agent.toolLoadingState.activeGroups.has(groupName);
	}

	/**
	 * Gets suggested tool groups for a task
	 */
	suggestGroups(taskDescription: string, projectContext?: { scmType?: 'github' | 'gitlab'; hasJira?: boolean }): { groups: string[]; hint: string } {
		// Import suggestion logic from toolGroups
		const { suggestToolGroups } = require('./toolGroups');
		const groups = suggestToolGroups(taskDescription, projectContext);

		const hint =
			groups.length > 0 ? `Based on your task, you may need these tool groups: ${groups.join(', ')}\nUse Agent_loadToolGroup("GroupName") when ready.` : '';

		return { groups, hint };
	}

	// Private methods

	private calculateCurrentToolTokens(agent: NextGenAgentContext): number {
		let total = 0;
		for (const group of agent.toolLoadingState.activeGroups) {
			total += estimateGroupTokens(group);
		}
		return total;
	}

	private async unloadLRU(agent: NextGenAgentContext, tokensNeeded: number): Promise<number> {
		// Get non-core groups sorted by load time (oldest first)
		const unloadable = Array.from(agent.toolLoadingState.activeGroups)
			.filter((g) => !getCoreGroups().includes(g))
			.sort((a, b) => {
				const timeA = agent.toolLoadingState.loadedAt.get(a) ?? 0;
				const timeB = agent.toolLoadingState.loadedAt.get(b) ?? 0;
				return timeA - timeB;
			});

		let freedTokens = 0;
		for (const group of unloadable) {
			if (freedTokens >= tokensNeeded) break;

			const tokens = estimateGroupTokens(group);
			this.unloadGroup(agent, group);
			freedTokens += tokens;
		}

		return freedTokens;
	}
}

/**
 * Creates the Agent_loadToolGroup function for agent use
 */
export function createLoadToolGroupFunction(loader: ToolLoader) {
	return async function Agent_loadToolGroup(agent: NextGenAgentContext, groupName: string): Promise<string> {
		const result = await loader.loadGroup(agent, groupName);

		if (!result.success) {
			throw new Error(result.error);
		}

		const group = getToolGroup(groupName);
		const schemas = await loader.getGroupSchemas(groupName);

		return `Loaded ${groupName} tools:\n${schemas.map((s) => `- ${s.name}`).join('\n')}`;
	};
}
