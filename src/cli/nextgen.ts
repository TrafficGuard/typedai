import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { initApplicationContext } from '#app/applicationContext';
import { defaultLLMs } from '#llm/services/defaultLlms';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { type NextGenOrchestrator, type SubtaskMergeResponse, createNextGenOrchestrator } from '../agent/nextgen/core/nextGenOrchestrator';
import { CliInteractionProvider, type UserInteractionProvider, createSubtaskReviewOptions } from '../agent/nextgen/interaction';
import { KnowledgeBase } from '../agent/nextgen/learning/knowledgeBase';
import type { BranchChanges, TaskDefinition } from '../agent/nextgen/orchestrator/milestone';
import { createTaskPlanner } from '../agent/nextgen/orchestrator/taskPlanner';
import { parseProcessArgs } from './cli';

/**
 * NextGen CLI Runner
 *
 * Runs the NextGen agent with interactive review at each subtask merge.
 *
 * Usage:
 *   npm run nextgen "Migrate the current angular/fastify app to Next.js 16, in the folder nextjs/"
 */

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Formats task plan details for approval display
 */
function formatTaskPlanDetails(task: TaskDefinition): string {
	const lines: string[] = [];

	let totalSubtasks = 0;
	for (const milestone of task.milestones) {
		totalSubtasks += milestone.subtasks.length;
		lines.push(`📍 Milestone ${milestone.id}: ${milestone.name}`);
		lines.push(`   ${milestone.description}`);
		if (milestone.completionCriteria.length > 0) {
			lines.push('   Completion criteria:');
			for (const criterion of milestone.completionCriteria) {
				lines.push(`     ✓ ${criterion}`);
			}
		}
		lines.push(`   Subtasks (${milestone.subtasks.length}):`);
		for (const subtask of milestone.subtasks) {
			lines.push(`     - ${subtask.id}: ${subtask.description}`);
			if (subtask.acceptanceCriteria) {
				lines.push(`       Acceptance: ${subtask.acceptanceCriteria}`);
			}
			if (subtask.expectedScope.expectedFiles.length > 0) {
				lines.push(`       Files: ${subtask.expectedScope.expectedFiles.join(', ')}`);
			}
		}
		lines.push('');
	}

	lines.push(`Total: ${task.milestones.length} milestones, ${totalSubtasks} subtasks`);
	return lines.join('\n');
}

/**
 * Formats branch changes details for review display
 */
function formatBranchChangesDetails(subtaskId: string, branchChanges: BranchChanges): string {
	const lines: string[] = [];

	if (branchChanges.filesChanged.length > 0) {
		lines.push('Files changed:');
		lines.push(`  ${branchChanges.filesChanged.slice(0, 10).join('\n  ')}`);
		if (branchChanges.filesChanged.length > 10) {
			lines.push(`  ... and ${branchChanges.filesChanged.length - 10} more`);
		}
	}

	lines.push('');
	lines.push(`Commits: ${branchChanges.commits.length}`);
	if (branchChanges.commits.length > 0) {
		lines.push(`  ${branchChanges.commits.slice(0, 5).join('\n  ')}`);
	}

	lines.push('');
	lines.push('Review the changes:');
	lines.push('  git diff HEAD~1');
	lines.push('  git log --oneline -10');

	return lines.join('\n');
}

// ============================================================================
// Main CLI Runner
// ============================================================================

async function main() {
	await initApplicationContext();

	const llms: AgentLLMs = defaultLLMs();
	const { initialPrompt, flags } = parseProcessArgs();

	if (!initialPrompt) {
		console.error('Usage: npm run nextgen "Your task description"');
		console.error('\nExample:');
		console.error('  npm run nextgen "Migrate the current angular/fastify app to Next.js 16, in the folder nextjs/"');
		process.exit(1);
	}

	console.log('\n🚀 NextGen Agent Starting');
	console.log(`Task: ${initialPrompt}\n`);

	// Use CliInteractionProvider for user input - recreates readline to avoid stdin closure issues
	const interaction: UserInteractionProvider = new CliInteractionProvider();
	const workingDirectory = process.cwd();

	try {
		// Create knowledge base
		const knowledgeBase = new KnowledgeBase({
			basePath: `${workingDirectory}/.typedai/learnings`,
		});
		await knowledgeBase.initialize();

		// Create task planner
		const planner = createTaskPlanner({
			llms,
			knowledgeBase,
			workingDirectory,
		});

		// Plan the task with feedback loop
		let task: TaskDefinition;
		let additionalContext: string | undefined;

		while (true) {
			console.log('📝 Planning task (using Claude Agent for research)...');
			const planResult = await planner.plan({
				prompt: initialPrompt,
				additionalContext,
			});
			task = planResult.task;

			// Show planning stats
			console.log('\n📊 Planning Stats:');
			console.log(`   Session: ${planResult.sessionId}`);
			console.log(`   Turns: ${planResult.turns}`);
			console.log(`   Cost: $${planResult.cost.toFixed(4)}`);

			// Display and confirm plan using interaction provider
			const planDetails = formatTaskPlanDetails(task);
			const planResponse = await interaction.requestApproval({
				id: `plan-${task.id}`,
				title: '📋 TASK PLAN',
				summary: `Task: ${task.description}\nID: ${task.id}`,
				details: planDetails,
				options: [
					{ id: 'approve', label: 'Proceed', description: 'Start executing the plan', isDefault: true },
					{ id: 'revise', label: 'Revise', description: 'Provide feedback to regenerate plan' },
					{ id: 'abort', label: 'Abort', description: 'Cancel and exit' },
				],
			});

			if (planResponse.optionId === 'approve') {
				break; // Proceed with execution
			}

			if (planResponse.optionId === 'abort') {
				console.log('Aborted.');
				interaction.close();
				return;
			}

			// Handle revise - get feedback and re-plan
			if (planResponse.optionId === 'revise' || planResponse.optionId === 'feedback') {
				const feedback = planResponse.feedback ?? '';
				if (!feedback) {
					// Prompt for feedback if not provided inline
					const feedbackResponse = await interaction.requestApproval({
						id: `feedback-${task.id}`,
						title: '📝 Plan Feedback',
						summary: 'What should be changed in the plan? (Enter your feedback)',
						options: [{ id: 'submit', label: 'Submit' }],
					});
					additionalContext = feedbackResponse.feedback ?? '';
				} else {
					additionalContext = feedback;
				}

				if (!additionalContext) {
					console.log('No feedback provided, please try again.');
					continue;
				}

				console.log(`\n🔄 Re-planning with feedback: ${additionalContext}\n`);
			}
		}

		// Create the orchestrator with interactive callbacks
		const functions = new LlmFunctionsImpl();
		const orchestrator = createNextGenOrchestrator({
			workingDirectory,
			llms,
			functions,
			callbacks: {
				// Called after each subtask merges
				onSubtaskMerged: async (taskId: string, subtaskId: string, branchChanges: BranchChanges): Promise<SubtaskMergeResponse> => {
					const details = formatBranchChangesDetails(subtaskId, branchChanges);
					const response = await interaction.requestApproval({
						id: `subtask-${subtaskId}`,
						title: `📋 SUBTASK COMPLETED: ${subtaskId}`,
						summary: `Files changed: ${branchChanges.filesChanged.length}, Lines: +${branchChanges.linesAdded} / -${branchChanges.linesRemoved}`,
						details,
						options: createSubtaskReviewOptions(),
					});

					if (response.optionId === 'continue') {
						return 'continue';
					}
					if (response.optionId === 'abort') {
						return 'abort';
					}
					// Feedback option
					return { action: 'feedback', message: response.feedback ?? '' };
				},

				// Called for major decisions
				onDecisionRequired: async (question: string, options: string[], context: string): Promise<string> => {
					const response = await interaction.requestApproval({
						id: `decision-${Date.now()}`,
						title: '❓ Decision Required',
						summary: question,
						details: context.length > 200 ? `${context.slice(0, 200)}...` : context,
						options: options.map((opt, i) => ({
							id: `option-${i}`,
							label: opt,
							isDefault: i === 0,
						})),
					});

					// Return the selected option text
					const selectedIndex = Number.parseInt(response.optionId.replace('option-', ''), 10);
					return options[selectedIndex] ?? response.feedback ?? options[0];
				},

				// Called when parallel options are ready
				onParallelOptionsReady: async (taskId: string, options: any[]): Promise<string> => {
					const details = options
						.map((opt, i) => {
							let line = `${i + 1}. ${opt.name || opt.optionName}: ${opt.summary || 'No summary'}`;
							if (opt.diffStats) {
								line += `\n   Files: ${opt.diffStats.filesChanged}, Lines: +${opt.diffStats.linesAdded}/-${opt.diffStats.linesRemoved}`;
							}
							return line;
						})
						.join('\n');

					const response = await interaction.requestApproval({
						id: `parallel-${taskId}`,
						title: '🔀 Parallel Options Ready',
						summary: 'Select which implementation to use:',
						details,
						options: options.map((opt, i) => ({
							id: opt.optionId || opt.id || `option-${i}`,
							label: opt.name || opt.optionName,
							description: opt.summary,
							isDefault: i === 0,
						})),
					});

					return response.optionId;
				},

				// Called when human review is needed
				onReviewRequired: async (taskId: string, subtaskId: string, review: any): Promise<'approved' | 'changes_requested'> => {
					let details = `Decision: ${review.decision}\nReasoning: ${review.reasoning}`;
					if (review.issues?.length > 0) {
						details += '\n\nIssues:';
						review.issues.forEach((issue: any) => {
							details += `\n  - [${issue.severity}] ${issue.description}`;
						});
					}

					const response = await interaction.requestApproval({
						id: `review-${subtaskId}`,
						title: `👀 Review Required for ${subtaskId}`,
						summary: `Decision: ${review.decision}`,
						details,
						options: [
							{ id: 'approved', label: 'Approve', isDefault: true },
							{ id: 'changes_requested', label: 'Request Changes' },
						],
					});

					return response.optionId === 'approved' ? 'approved' : 'changes_requested';
				},
			},
		});

		// Initialize and start
		await orchestrator.initialize();

		// Add event listener for progress
		orchestrator.addEventListener((event) => {
			switch (event.type) {
				case 'task_started':
					console.log(`\n🚀 Task started: ${event.taskId}`);
					break;
				case 'milestone_started':
					console.log(`\n📍 Starting milestone: ${event.milestoneId}`);
					break;
				case 'milestone_completed':
					console.log(`\n✅ Milestone completed: ${event.milestoneId}`);
					break;
				case 'subtask_started':
					console.log(`\n🔨 Starting subtask: ${event.subtaskId}`);
					break;
				case 'subtask_completed':
					console.log(`✓ Subtask completed: ${event.subtaskId}`);
					break;
				case 'task_completed':
					console.log(`\n🎉 Task completed: ${event.taskId}`);
					break;
				case 'task_failed':
					console.log(`\n❌ Task failed: ${event.taskId} - ${event.error}`);
					break;
			}
		});

		console.log('\n🔨 Starting execution...\n');
		await orchestrator.startTask(task);

		console.log('\n✨ NextGen Agent finished!');
	} catch (error) {
		console.error('\n❌ Error:', error);
		throw error;
	} finally {
		interaction.close();
	}
}

main().then(
	() => {
		console.log('Done');
		process.exit(0);
	},
	(e) => {
		console.error(e);
		process.exit(1);
	},
);
