/**
 * Initializer Agent
 *
 * Creates the domain memory structure for a new task.
 * Runs once per task to generate goals.yaml from the task description.
 *
 * Tools: Read-only (file_tree, query, grep, discovery)
 * Output: goals.yaml, initial status.json, initial progress.md
 */

import type { AgentLLMs } from '#shared/agent/agent.model';
import { extractAssistantText, unstable_v2_createSession, unstable_v2_prompt } from '../agentSdk.js';
import type { KnowledgeBase, Learning } from '../learning/knowledgeBase';
import {
	type DomainMemoryPaths,
	type Feature,
	type GoalTree,
	type MilestoneGoal,
	type SubtaskGoal,
	type TaskStatus,
	createFeature,
	createGoalTree,
	createMilestone,
	createSubtask,
	getAllFeatures,
	getGoalTreeStats,
	validateGoalTree,
} from '../memory/index.js';
import { getDomainMemoryPaths, initializeDomainMemory, initializeProgressLog, logInitialization } from '../memory/index.js';
import { initializeStatus } from '../memory/index.js';

// =============================================================================
// Types
// =============================================================================

export interface InitializerAgentConfig {
	llms: AgentLLMs;
	knowledgeBase?: KnowledgeBase;
	workingDirectory: string;
	/** Task ID (if not provided, one will be generated) */
	taskId?: string;
	maxMilestones?: number;
	maxSubtasksPerMilestone?: number;
	maxFeaturesPerSubtask?: number;
}

export interface InitializerAgentInput {
	/** High-level task description */
	taskDescription: string;
	/** Additional context or constraints */
	additionalContext?: string;
	/** Initial files to focus on */
	initialFiles?: string[];
}

export interface InitializerAgentResult {
	taskId: string;
	goals: GoalTree;
	status: TaskStatus;
	paths: DomainMemoryPaths;
	stats: {
		milestones: number;
		subtasks: number;
		features: number;
	};
	cost: number;
	turns: number;
}

// =============================================================================
// Initializer Agent
// =============================================================================

/**
 * Run the initializer agent to create domain memory for a new task.
 */
export async function runInitializerAgent(config: InitializerAgentConfig, input: InitializerAgentInput): Promise<InitializerAgentResult> {
	const taskId = config.taskId || generateTaskId();
	const paths = getDomainMemoryPaths(config.workingDirectory, taskId);

	// 1. Gather codebase context using discovery
	const codebaseContext = await gatherCodebaseContext(config, input);

	// 2. Get relevant learnings from knowledge base
	const learnings = config.knowledgeBase ? await config.knowledgeBase.retrieveRelevant(input.taskDescription) : [];

	// 3. Generate goals using LLM
	const { goals, cost, turns } = await generateGoals(config, input, codebaseContext, learnings);

	// 4. Validate the goal tree
	const validation = validateGoalTree(goals);
	if (!validation.valid) {
		throw new Error(`Invalid goal tree: ${validation.errors.join(', ')}`);
	}

	// 5. Initialize status (all features pending)
	const status = initializeStatus(taskId, goals);

	// 6. Initialize domain memory files
	await initializeDomainMemory(paths, goals, status);
	await initializeProgressLog(paths, taskId, goals.description);

	// 7. Log initialization
	const stats = getGoalTreeStats(goals);
	await logInitialization(paths, goals, {
		milestonesCount: stats.milestones,
		featuresCount: stats.features,
	});

	return {
		taskId,
		goals,
		status,
		paths,
		stats: {
			milestones: stats.milestones,
			subtasks: stats.subtasks,
			features: stats.features,
		},
		cost,
		turns,
	};
}

// =============================================================================
// Codebase Context Gathering
// =============================================================================

async function gatherCodebaseContext(config: InitializerAgentConfig, input: InitializerAgentInput): Promise<string> {
	// Use a prompt to gather codebase context
	// This would integrate with discovery tools

	const discoveryPrompt = `
You are exploring a codebase to understand its structure for planning a task.

Task: ${input.taskDescription}

${input.additionalContext ? `Additional Context: ${input.additionalContext}` : ''}

${input.initialFiles?.length ? `Initial Files to Focus On: ${input.initialFiles.join(', ')}` : ''}

Please explore the codebase and provide:
1. Overall project structure
2. Key technologies and frameworks used
3. Relevant files and components for this task
4. Existing patterns and conventions
5. Any potential challenges or considerations

Be concise and focus on information relevant to the task.
`;

	try {
		const result = await unstable_v2_prompt(discoveryPrompt, {
			model: config.llms.easy.getModel(), // Use fast model for discovery
			cwd: config.workingDirectory,
			permissionMode: 'default', // Read-only by default
		});

		return result.result;
	} catch (error) {
		// Fallback to basic context if discovery fails
		return 'Unable to gather codebase context. Proceeding with task description only.';
	}
}

// =============================================================================
// Goal Generation
// =============================================================================

async function generateGoals(
	config: InitializerAgentConfig,
	input: InitializerAgentInput,
	codebaseContext: string,
	learnings: Learning[],
): Promise<{ goals: GoalTree; cost: number; turns: number }> {
	const maxMilestones = config.maxMilestones ?? 5;
	const maxSubtasksPerMilestone = config.maxSubtasksPerMilestone ?? 5;
	const maxFeaturesPerSubtask = config.maxFeaturesPerSubtask ?? 5;

	const prompt = buildGoalGenerationPrompt(input, codebaseContext, learnings, {
		maxMilestones,
		maxSubtasksPerMilestone,
		maxFeaturesPerSubtask,
	});

	const result = await unstable_v2_prompt(prompt, {
		model: config.llms.medium.getModel(), // Use medium model for planning
		cwd: config.workingDirectory,
		permissionMode: 'default',
	});

	// Parse the generated goals
	const goals = parseGoalsFromResponse(result.result, input.taskDescription);

	return {
		goals,
		cost: result.totalCostUsd,
		turns: result.numTurns,
	};
}

function buildGoalGenerationPrompt(
	input: InitializerAgentInput,
	codebaseContext: string,
	learnings: Learning[],
	limits: {
		maxMilestones: number;
		maxSubtasksPerMilestone: number;
		maxFeaturesPerSubtask: number;
	},
): string {
	const learningsSection =
		learnings.length > 0
			? `
## Relevant Code Patterns

${learnings.map((l) => `- **${l.category}**: ${l.content}`).join('\n')}
`
			: '';

	return `
# Task Planning

You are creating a detailed plan for the following task:

## Task Description
${input.taskDescription}

${input.additionalContext ? `## Additional Context\n${input.additionalContext}` : ''}

## Codebase Analysis
${codebaseContext}

${learningsSection}

## Planning Requirements

Create a hierarchical plan with:
- **Milestones**: Major deliverables (max ${limits.maxMilestones})
- **Subtasks**: Logical groupings within milestones (max ${limits.maxSubtasksPerMilestone} per milestone)
- **Features**: Atomic units of work with test commands (max ${limits.maxFeaturesPerSubtask} per subtask)

For each feature, you MUST provide a testCommand that can verify the feature works.
Test commands should be specific and runnable (e.g., "pnpm test:unit -- --grep 'auth'" or "npm run test:integration -- auth.test.ts").

## Output Format

Respond with a JSON object in this exact format:

\`\`\`json
{
  "task": "Short task name",
  "description": "Full task description",
  "milestones": [
    {
      "id": "ms-1",
      "name": "Milestone Name",
      "description": "What this milestone delivers",
      "requiresHumanReview": false,
      "dependsOn": [],
      "subtasks": [
        {
          "id": "ms-1-st-1",
          "name": "Subtask Name",
          "description": "What this subtask accomplishes",
          "features": [
            {
              "id": "ms-1-st-1-ft-1",
              "description": "Specific feature description",
              "testCommand": "pnpm test:unit -- --grep 'feature'",
              "dependsOn": [],
              "estimatedComplexity": "low"
            }
          ]
        }
      ]
    }
  ]
}
\`\`\`

Important:
- Every feature MUST have a specific, runnable testCommand
- Use descriptive IDs that follow the pattern (ms-N, ms-N-st-N, ms-N-st-N-ft-N)
- Set requiresHumanReview: true for milestones with significant changes
- Set dependencies (dependsOn) for milestones/features that require prior work
- estimatedComplexity should be "low", "medium", or "high"

Generate the plan now:
`;
}

function parseGoalsFromResponse(response: string, taskDescription: string): GoalTree {
	// Extract JSON from response
	const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
	const jsonStr = jsonMatch ? jsonMatch[1] : response;

	try {
		const parsed = JSON.parse(jsonStr);

		// Convert to GoalTree format
		const milestones: MilestoneGoal[] = (parsed.milestones || []).map((m: any) => ({
			id: m.id,
			name: m.name,
			description: m.description,
			requiresHumanReview: m.requiresHumanReview ?? false,
			dependsOn: m.dependsOn || [],
			completionCriteria: m.completionCriteria || [],
			subtasks: (m.subtasks || []).map((s: any) => ({
				id: s.id,
				name: s.name,
				description: s.description,
				features: (s.features || []).map((f: any) => ({
					id: f.id,
					description: f.description,
					testCommand: f.testCommand,
					dependsOn: f.dependsOn || [],
					estimatedComplexity: f.estimatedComplexity || 'medium',
				})),
			})),
		}));

		return {
			task: parsed.task || 'Task',
			description: parsed.description || taskDescription,
			createdAt: new Date().toISOString(),
			milestones,
		};
	} catch (error) {
		throw new Error(`Failed to parse goals from LLM response: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

// =============================================================================
// Helpers
// =============================================================================

function generateTaskId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 6);
	return `task-${timestamp}-${random}`;
}

/**
 * Generate test commands for features that are missing them.
 * This is a fallback for when the LLM doesn't generate good test commands.
 */
export function generateTestCommandsForFeatures(goals: GoalTree, projectType: 'node' | 'python' | 'go' | 'rust' = 'node'): GoalTree {
	const testRunners: Record<string, string> = {
		node: 'pnpm test',
		python: 'pytest',
		go: 'go test',
		rust: 'cargo test',
	};

	const baseCommand = testRunners[projectType];

	const updatedMilestones = goals.milestones.map((milestone) => ({
		...milestone,
		subtasks: milestone.subtasks.map((subtask) => ({
			...subtask,
			features: subtask.features.map((feature) => ({
				...feature,
				testCommand: feature.testCommand || `${baseCommand} -- --grep "${feature.id}"`,
			})),
		})),
	}));

	return {
		...goals,
		milestones: updatedMilestones,
	};
}

/**
 * Validate that all features have test commands.
 */
export function validateTestCommands(goals: GoalTree): {
	valid: boolean;
	missingTestCommands: string[];
} {
	const allFeatures = getAllFeatures(goals);
	const missing = allFeatures.filter((f) => !f.testCommand || f.testCommand.trim() === '').map((f) => f.id);

	return {
		valid: missing.length === 0,
		missingTestCommands: missing,
	};
}
