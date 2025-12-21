/**
 * Task Planner
 *
 * Uses a Claude Agent session to research the codebase and create
 * a comprehensive plan with milestones and subtasks.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { KnowledgeBase } from '../learning/knowledgeBase';
import type { DomainMemoryPaths, GoalTree } from '../memory/types';
import { createRepositoryToolsServer } from '../tools/repositoryTools';
import { type InitializerAgentConfig, type InitializerAgentInput, runInitializerAgent } from './initializerAgent';
import {
	DEFAULT_SCOPE,
	type FeatureDefinition,
	type Milestone,
	type PinnedContextItem,
	type ScopeDefinition,
	type SubtaskDefinition,
	type TaskDefinition,
} from './milestone';

// ============================================================================
// Task Planner Types
// ============================================================================

/**
 * Configuration for the task planner
 */
export interface TaskPlannerConfig {
	/** LLMs to use for planning and tools */
	llms: AgentLLMs;
	/** Knowledge base for code patterns */
	knowledgeBase: KnowledgeBase;
	/** Working directory */
	workingDirectory: string;
	/** Optional max milestones */
	maxMilestones?: number;
	/** Optional max subtasks per milestone */
	maxSubtasksPerMilestone?: number;
}

/**
 * Input for creating a task
 */
export interface TaskPlannerInput {
	/** The high-level task prompt */
	prompt: string;
	/** Optional additional context */
	additionalContext?: string;
	/** Optional list of files to consider */
	initialFiles?: string[];
}

/**
 * Result from task planning
 */
export interface TaskPlannerResult {
	/** The created task definition */
	task: TaskDefinition;
	/** Planning session ID (for reviewing agent's work) */
	sessionId: string;
	/** Total cost of planning */
	cost: number;
	/** Number of turns the agent took */
	turns: number;
}

// ============================================================================
// LLM Response Types
// ============================================================================

interface LLMMilestone {
	name: string;
	description: string;
	dependsOn: string[];
	completionCriteria: string[];
	requiresHumanReview: boolean;
	subtasks: LLMSubtask[];
}

interface LLMSubtask {
	description: string;
	acceptanceCriteria?: string;
	dependsOn: string[];
	complexity: 'simple' | 'moderate' | 'complex';
	expectedFiles: string[];
	expectedComponents: string[];
}

interface LLMTaskPlan {
	summary: string;
	milestones: LLMMilestone[];
	pinnedContext: Array<{ key: string; content: string; reason: string }>;
}

// ============================================================================
// Task Planner Implementation
// ============================================================================

/**
 * Plans a task using a Claude Agent session that can research the codebase
 */
export class TaskPlanner {
	private config: TaskPlannerConfig;

	constructor(config: TaskPlannerConfig) {
		this.config = config;
	}

	/**
	 * Creates a task definition from a high-level prompt using a Claude Agent
	 */
	async plan(input: TaskPlannerInput): Promise<TaskPlannerResult> {
		logger.info({ prompt: input.prompt.slice(0, 100) }, 'Starting task planning with agent');

		// Retrieve relevant learnings from knowledge base
		const learnings = await this.config.knowledgeBase.retrieve({
			text: input.prompt,
			types: ['pattern', 'preference', 'pitfall'],
			minConfidence: 0.6,
			limit: 10,
		});

		const learningsStr =
			learnings.length > 0
				? learnings.map((l) => `- [${l.type}] ${l.content} (confidence: ${(l.confidence * 100).toFixed(0)}%)`).join('\n')
				: 'No specific learnings available.';

		// Build the planning prompt
		const prompt = this.buildPlanningPrompt(input, learningsStr);

		// Create repository tools for the agent
		const repositoryTools = createRepositoryToolsServer({ llms: this.config.llms });

		// Run the planning agent using SDK directly
		logger.info('Starting planning agent session');

		// MCP tools require streaming input mode - use async generator
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async function* generateMessages(): AsyncGenerator<any> {
			yield {
				type: 'user',
				message: {
					role: 'user',
					content: prompt,
				},
			};
		}

		const q = query({
			prompt: generateMessages(),
			options: {
				model: 'claude-sonnet-4-5-20250929',
				systemPrompt: this.buildSystemPrompt(),
				mcpServers: {
					'repository-tools': repositoryTools,
				},
				cwd: this.config.workingDirectory,
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				settingSources: ['project', 'local'],
				stderr: (data) => {
					logger.error({ stderr: data }, 'Claude Code stderr');
				},
			},
		});

		// Collect the result
		let result: { result: string; sessionId: string; totalCostUsd: number; numTurns: number } | null = null;
		for await (const msg of q) {
			if (msg.type === 'result') {
				if (msg.subtype === 'success') {
					result = {
						result: msg.result,
						sessionId: msg.session_id,
						totalCostUsd: msg.total_cost_usd,
						numTurns: msg.num_turns,
					};
				} else {
					const errorMsg = msg as { errors?: string[] };
					throw new Error(`Query failed (${msg.subtype}): ${errorMsg.errors?.join(', ') || 'Unknown error'}`);
				}
			}
		}

		if (!result) {
			throw new Error('No result received from query');
		}

		logger.info(
			{
				sessionId: result.sessionId,
				cost: result.totalCostUsd,
				turns: result.numTurns,
			},
			'Planning agent completed',
		);

		// Parse the plan from the agent's response
		const plan = this.extractPlanFromResult(result.result);

		// Build the task definition
		const task = this.buildTaskDefinition(input.prompt, plan);

		logger.info(
			{
				taskId: task.id,
				milestones: task.milestones.length,
				totalSubtasks: task.milestones.reduce((sum, m) => sum + m.subtasks.length, 0),
			},
			'Task planning complete',
		);

		return {
			task,
			sessionId: result.sessionId,
			cost: result.totalCostUsd,
			turns: result.numTurns,
		};
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Builds the system prompt for the planning agent
	 */
	private buildSystemPrompt(): string {
		return `You are a senior software architect creating implementation plans for complex tasks.

You have access to tools to explore the codebase:
- \`mcp__repository-tools__file_tree\`: View the project structure with file/folder summaries
- \`mcp__repository-tools__query\`: Ask questions about the codebase and get answers with file citations
- Standard tools: Read files, search with Grep/Glob, etc.

Your job is to:
1. THOROUGHLY research the codebase to understand all relevant patterns
2. Create a comprehensive, detailed plan with milestones and subtasks

Be thorough in your research. For migration/refactoring tasks, you MUST understand ALL patterns being migrated - auth, config, state management, API patterns, special modes, etc.`;
	}

	/**
	 * Builds the planning prompt
	 */
	private buildPlanningPrompt(input: TaskPlannerInput, learningsStr: string): string {
		return `# Task Planning Request

## Task
${input.prompt}

${input.additionalContext ? `## Additional Context\n${input.additionalContext}\n` : ''}

## Code Patterns & Preferences (from Knowledge Base)
${learningsStr}

---

# Instructions

## Step 1: Research the Codebase (REQUIRED)

Before creating your plan, you MUST use the custom MCP tools to research the codebase:

**IMPORTANT: Start by calling these tools:**

1. **FIRST** call \`mcp__repository-tools__file_tree\` to see the project structure with summaries
   - This gives you an overview of all folders and files with their descriptions
   - Pass a query parameter to filter for relevant folders (e.g., query: "fastify routes")

2. **THEN** call \`mcp__repository-tools__query\` to understand patterns relevant to your task
   - Example: question: "How are Fastify routes defined and registered in this codebase?"
   - Example: question: "What patterns are used for API endpoint handlers?"
   - This returns answers with file citations

3. After using the MCP tools above, you may use standard tools (Read, Grep, Glob) to examine specific files

**YOU MUST call mcp__repository-tools__file_tree and mcp__repository-tools__query before creating your plan.**
DO NOT skip this research phase. Vague plans from insufficient research lead to poor implementations.

## Step 2: Create the Plan

After researching, create a comprehensive plan.

**Milestones** are significant deliverables that can be reviewed independently:
- Each milestone should represent a coherent, working state
- Keep milestones to ${this.config.maxMilestones ?? 5}-${(this.config.maxMilestones ?? 5) + 5}
- Order by dependency - foundational work first

**Subtasks** are individual units of work within a milestone:
- Be SPECIFIC: "Create UserCard component with avatar, name, and role props" NOT "Create user components"
- Include acceptance criteria
- List exact files to create/modify
- Maximum ${this.config.maxSubtasksPerMilestone ?? 8} subtasks per milestone

**Pinned Context** is information ALL subtasks need:
- Architectural decisions
- Naming conventions
- Technology choices
- Constraints

## Step 3: Return Your Plan

After completing your research, respond with the plan as JSON:

\`\`\`json
{
  "summary": "Brief summary including key architectural decisions discovered during research",
  "milestones": [
    {
      "name": "Milestone Name (specific, e.g., 'Next.js Project Setup' not 'Setup')",
      "description": "What this milestone delivers and WHY it must come before later milestones",
      "dependsOn": [],
      "completionCriteria": [
        "Specific, verifiable criterion (e.g., 'npm run build succeeds')"
      ],
      "requiresHumanReview": true,
      "subtasks": [
        {
          "description": "SPECIFIC task with enough detail for an AI to implement without questions",
          "acceptanceCriteria": "How to verify this subtask is complete",
          "dependsOn": [],
          "complexity": "simple",
          "expectedFiles": ["src/path/to/file.ts"],
          "expectedComponents": ["ComponentName"]
        }
      ]
    }
  ],
  "pinnedContext": [
    {
      "key": "architecture",
      "content": "Discovered architectural pattern to follow",
      "reason": "Why all subtasks need to know this"
    }
  ]
}
\`\`\`

Remember: Research FIRST, then plan. Your plan quality depends on your research quality.`;
	}

	/**
	 * Extracts the plan JSON from the agent's response
	 */
	private extractPlanFromResult(result: string): LLMTaskPlan {
		logger.debug({ resultLength: result.length, resultPreview: result.slice(0, 500) }, 'Extracting plan from agent result');

		// Try to find JSON in the response
		const jsonMatch = result.match(/```json\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			logger.debug('Found JSON in code block');
			const plan = JSON.parse(jsonMatch[1]) as LLMTaskPlan;
			this.validatePlan(plan);
			return plan;
		}

		// Try to find raw JSON object
		const rawJsonMatch = result.match(/\{[\s\S]*"milestones"[\s\S]*\}/);
		if (rawJsonMatch) {
			logger.debug('Found raw JSON object');
			const plan = JSON.parse(rawJsonMatch[0]) as LLMTaskPlan;
			this.validatePlan(plan);
			return plan;
		}

		logger.error({ result }, 'No valid plan JSON found in agent response');
		throw new Error('No valid plan JSON found in agent response');
	}

	/**
	 * Validates the plan structure
	 */
	private validatePlan(plan: LLMTaskPlan): void {
		if (!plan.milestones || !Array.isArray(plan.milestones)) {
			throw new Error('Invalid plan: missing milestones array');
		}

		if (plan.milestones.length === 0) {
			throw new Error('Invalid plan: no milestones defined');
		}

		for (const milestone of plan.milestones) {
			if (!milestone.name || !milestone.subtasks || milestone.subtasks.length === 0) {
				throw new Error(`Invalid milestone: ${milestone.name || 'unnamed'} has no subtasks`);
			}
		}
	}

	/**
	 * Builds the final task definition from the plan
	 */
	private buildTaskDefinition(prompt: string, plan: LLMTaskPlan): TaskDefinition {
		const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const now = Date.now();

		// Build milestones
		const milestones: Milestone[] = plan.milestones.map((m, mIndex) => {
			const milestoneId = `ms-${mIndex + 1}`;

			// Build subtasks for this milestone
			const subtasks: SubtaskDefinition[] = m.subtasks.map((s, sIndex) => {
				const subtaskId = `${milestoneId}-st-${sIndex + 1}`;

				const scope: ScopeDefinition = {
					expectedFiles: s.expectedFiles || [],
					expectedComponents: s.expectedComponents || [],
					forbiddenPaths: DEFAULT_SCOPE.forbiddenPaths,
					maxIterations: s.complexity === 'complex' ? 30 : s.complexity === 'moderate' ? 20 : 10,
					maxCost: s.complexity === 'complex' ? 10.0 : s.complexity === 'moderate' ? 5.0 : 2.0,
				};

				return {
					id: subtaskId,
					description: s.description,
					acceptanceCriteria: s.acceptanceCriteria,
					expectedScope: scope,
					dependsOn: (s.dependsOn || []).map((dep) => `${milestoneId}-st-${dep}`),
					complexity: s.complexity || 'moderate',
				};
			});

			// Convert dependsOn names to IDs
			const dependsOnIds = (m.dependsOn || []).map((dep) => {
				const depIndex = plan.milestones.findIndex((ms) => ms.name === dep);
				return depIndex >= 0 ? `ms-${depIndex + 1}` : dep;
			});

			return {
				id: milestoneId,
				name: m.name,
				description: m.description,
				status: 'pending' as const,
				dependsOn: dependsOnIds,
				subtasks,
				requiresHumanReview: m.requiresHumanReview ?? true,
				completionCriteria: m.completionCriteria || [],
			};
		});

		// Build pinned context
		const pinnedContext: PinnedContextItem[] = (plan.pinnedContext || []).map((p, index) => ({
			key: p.key || `context-${index}`,
			content: p.content,
			reason: p.reason,
			addedAt: now,
			addedBy: 'task-planner',
		}));

		return {
			id: taskId,
			description: prompt,
			milestones,
			decisions: [],
			pinnedContext,
			createdAt: now,
		};
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a task planner
 */
export function createTaskPlanner(config: TaskPlannerConfig): TaskPlanner {
	return new TaskPlanner(config);
}

// ============================================================================
// V2 Task Planner (Domain Memory)
// ============================================================================

/**
 * V2 Task Planner Configuration
 *
 * Uses the InitializerAgent to create domain memory (goals.yaml) instead of
 * in-memory TaskDefinition objects.
 */
export interface TaskPlannerV2Config {
	/** LLMs to use for planning */
	llms: AgentLLMs;
	/** Knowledge base for code patterns */
	knowledgeBase?: KnowledgeBase;
	/** Working directory */
	workingDirectory: string;
	/** Task ID for domain memory paths */
	taskId: string;
}

/**
 * V2 Task Planner Result
 */
export interface TaskPlannerV2Result {
	/** The created goal tree (also persisted to goals.yaml) */
	goalTree: GoalTree;
	/** Domain memory paths where files were created */
	paths: DomainMemoryPaths;
	/** Total cost of planning */
	cost: number;
}

/**
 * Plans a task using the v2 domain memory system.
 *
 * This delegates to the InitializerAgent which:
 * 1. Researches the codebase using discovery tools
 * 2. Creates goals.yaml with milestones/subtasks/features
 * 3. Generates testCommand for each feature
 * 4. Initializes status.json with all features pending
 * 5. Creates initial progress.md entry
 */
export async function planWithDomainMemory(config: TaskPlannerV2Config, input: TaskPlannerInput): Promise<TaskPlannerV2Result> {
	logger.info({ taskId: config.taskId, prompt: input.prompt.slice(0, 100) }, 'Starting v2 task planning with domain memory');

	const initConfig: InitializerAgentConfig = {
		llms: config.llms,
		knowledgeBase: config.knowledgeBase,
		workingDirectory: config.workingDirectory,
		taskId: config.taskId,
	};

	const initInput: InitializerAgentInput = {
		taskDescription: input.prompt,
		additionalContext: input.additionalContext,
		initialFiles: input.initialFiles,
	};

	const result = await runInitializerAgent(initConfig, initInput);

	logger.info(
		{
			taskId: config.taskId,
			milestones: result.goals.milestones.length,
			totalFeatures: result.goals.milestones.reduce((sum, m) => sum + m.subtasks.reduce((s, st) => s + st.features.length, 0), 0),
			cost: result.cost,
		},
		'V2 task planning complete',
	);

	return {
		goalTree: result.goals,
		paths: result.paths,
		cost: result.cost,
	};
}

/**
 * Converts a v1 TaskDefinition to v2 GoalTree format.
 *
 * This is useful for migrating existing task definitions to the new
 * domain memory system. Note that features will need testCommands
 * generated separately.
 */
export function convertTaskToGoalTree(task: TaskDefinition): GoalTree {
	return {
		task: task.id,
		description: task.description,
		createdAt: new Date(task.createdAt).toISOString(),
		milestones: task.milestones.map((m) => ({
			id: m.id,
			name: m.name,
			description: m.description,
			dependsOn: m.dependsOn,
			completionCriteria: m.completionCriteria,
			requiresHumanReview: m.requiresHumanReview,
			subtasks: m.subtasks.map((st) => ({
				id: st.id,
				name: st.description.slice(0, 50), // SubtaskGoal requires name
				description: st.description,
				// Convert subtasks to features if they exist, otherwise create one feature per subtask
				features:
					(st.features || []).length > 0
						? st.features!.map((f) => ({
								id: f.id,
								description: f.description,
								testCommand: f.testCommand,
								dependsOn: f.dependsOn,
								estimatedComplexity: f.estimatedComplexity,
							}))
						: [
								{
									id: `${st.id}-f-1`,
									description: st.description,
									testCommand: '', // Needs to be generated
									dependsOn: [],
									estimatedComplexity: st.complexity === 'simple' ? 'low' : st.complexity === 'complex' ? 'high' : 'medium',
								},
							],
			})),
		})),
	};
}
