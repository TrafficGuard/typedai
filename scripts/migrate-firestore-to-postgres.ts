#!/usr/bin/env tsx

/**
 * Migration script to copy data from Firestore to PostgreSQL
 *
 * Usage:
 *   npm run migrate:firestore-to-postgres
 *
 * Environment variables required:
 *   - GCLOUD_PROJECT: Google Cloud project ID
 *   - DATABASE_HOST: PostgreSQL host
 *   - DATABASE_PORT: PostgreSQL port
 *   - DATABASE_USER: PostgreSQL user
 *   - DATABASE_PASSWORD: PostgreSQL password
 *   - DATABASE_NAME: PostgreSQL database name
 *
 * Options:
 *   --dry-run: Preview what would be migrated without making changes
 *   --collection=<name>: Migrate only a specific collection
 *   --batch-size=<number>: Number of documents to process at once (default: 100)
 */

import { Firestore } from '@google-cloud/firestore';
import { logger } from '../src/o11y/logger';
import { db } from '../src/modules/postgres/db';
import { ensureAllTablesExist } from '../src/modules/postgres/schemaUtils';
import { envVar } from '../src/utils/env-var';

interface MigrationStats {
	collection: string;
	total: number;
	migrated: number;
	skipped: number;
	errors: number;
	errorDetails: Array<{ id: string; error: string }>;
}

interface MigrationOptions {
	dryRun: boolean;
	collection?: string;
	batchSize: number;
}

class FirestoreToPostgresMigrator {
	private firestoreDb: Firestore;
	private stats: Map<string, MigrationStats> = new Map();
	private options: MigrationOptions;

	constructor(options: MigrationOptions) {
		this.options = options;
		this.firestoreDb = new Firestore({
			projectId: envVar('GCLOUD_PROJECT'),
			databaseId: process.env.DATABASE_NAME,
		});
	}

	private initStats(collection: string): MigrationStats {
		const stats: MigrationStats = {
			collection,
			total: 0,
			migrated: 0,
			skipped: 0,
			errors: 0,
			errorDetails: [],
		};
		this.stats.set(collection, stats);
		return stats;
	}

	private getStats(collection: string): MigrationStats {
		return this.stats.get(collection)!;
	}

	async migrateUsers(): Promise<void> {
		logger.info('Migrating Users collection...');
		const stats = this.initStats('Users');

		const snapshot = await this.firestoreDb.collection('Users').get();
		stats.total = snapshot.size;

		for (const doc of snapshot.docs) {
			try {
				const data = doc.data();

				if (this.options.dryRun) {
					logger.info({ userId: doc.id }, 'Would migrate user [userId]');
					stats.migrated++;
					continue;
				}

				await db
					.insertInto('users')
					.values({
						id: doc.id,
						name: data.name || null,
						email: data.email,
						enabled: data.enabled ?? true,
						admin: data.admin ?? false,
						password_hash: data.passwordHash || null,
						hil_budget: data.hilBudget ?? 0,
						hil_count: data.hilCount ?? 0,
						last_login_at: data.lastLoginAt?.toDate() || null,
						created_at: data.createdAt?.toDate() || new Date(),
						llm_config_serialized: data.llmConfig ? JSON.stringify(data.llmConfig) : null,
						chat_config_serialized: data.chat ? JSON.stringify(data.chat) : null,
						function_config_serialized: data.functionConfig ? JSON.stringify(data.functionConfig) : null,
					})
					.onConflict((oc) => oc.column('id').doNothing())
					.execute();

				stats.migrated++;
			} catch (error: any) {
				stats.errors++;
				stats.errorDetails.push({ id: doc.id, error: error.message });
				logger.error(error, { userId: doc.id }, 'Error migrating user [userId]');
			}
		}
	}

	async migrateChats(): Promise<void> {
		logger.info('Migrating Chats collection...');
		const stats = this.initStats('Chats');

		const snapshot = await this.firestoreDb.collection('Chats').get();
		stats.total = snapshot.size;

		for (const doc of snapshot.docs) {
			try {
				const data = doc.data();

				if (this.options.dryRun) {
					logger.info({ chatId: doc.id }, 'Would migrate chat [chatId]');
					stats.migrated++;
					continue;
				}

				await db
					.insertInto('chats')
					.values({
						id: doc.id,
						user_id: data.userId,
						title: data.title,
						updated_at: data.updatedAt?.toDate() || new Date(),
						shareable: data.shareable ?? false,
						parent_id: data.parentId || null,
						root_id: data.rootId || null,
						messages_serialized: JSON.stringify(data.messages || []),
						created_at: data.createdAt?.toDate() || new Date(),
					})
					.onConflict((oc) => oc.column('id').doNothing())
					.execute();

				stats.migrated++;
			} catch (error: any) {
				stats.errors++;
				stats.errorDetails.push({ id: doc.id, error: error.message });
				logger.error(error, { chatId: doc.id }, 'Error migrating chat [chatId]');
			}
		}
	}

	async migrateAgentContexts(): Promise<void> {
		logger.info('Migrating AgentContext collection...');
		const stats = this.initStats('AgentContext');

		const snapshot = await this.firestoreDb.collection('AgentContext').get();
		stats.total = snapshot.size;

		for (const doc of snapshot.docs) {
			try {
				const data = doc.data();

				if (this.options.dryRun) {
					logger.info({ agentId: doc.id }, 'Would migrate agent context [agentId]');
					stats.migrated++;
					continue;
				}

				// Migrate agent context
				await db
					.insertInto('agent_contexts')
					.values({
						agent_id: doc.id,
						execution_id: data.executionId,
						container_id: data.containerId || null,
						typed_ai_repo_dir: data.typedAiRepoDir,
						trace_id: data.traceId,
						name: data.name || null,
						parent_agent_id: data.parentAgentId || null,
						user_id: data.userId,
						state: data.state,
						call_stack: data.callStack ? JSON.stringify(data.callStack) : null,
						error: data.error || null,
						hil_budget: data.hilBudget || null,
						hil_count: data.hilCount || null,
						cost: data.cost || 0,
						budget_remaining: data.budgetRemaining || null,
						llms_serialized: JSON.stringify(data.llms || {}),
						use_shared_repos: data.useSharedRepos || null,
						memory_serialized: JSON.stringify(data.memory || {}),
						last_update: data.lastUpdate?.toDate() || new Date(),
						metadata_serialized: data.metadata ? JSON.stringify(data.metadata) : null,
						functions_serialized: JSON.stringify(data.functions || {}),
						completed_handler_id: data.completedHandlerId || null,
						pending_messages_serialized: data.pendingMessages ? JSON.stringify(data.pendingMessages) : null,
						type: data.type,
						subtype: data.subtype || null,
						iterations: data.iterations || 0,
						invoking_serialized: data.invoking ? JSON.stringify(data.invoking) : null,
						notes_serialized: data.notes ? JSON.stringify(data.notes) : null,
						user_prompt: data.userPrompt || null,
						input_prompt: data.inputPrompt,
						messages_serialized: JSON.stringify(data.messages || []),
						function_call_history_serialized: data.functionCallHistory ? JSON.stringify(data.functionCallHistory) : null,
						live_files_serialized: data.liveFiles ? JSON.stringify(data.liveFiles) : null,
						child_agents_ids: data.childAgentsIds ? JSON.stringify(data.childAgentsIds) : null,
						hil_requested: data.hilRequested || null,
						created_at: data.createdAt?.toDate() || new Date(),
					})
					.onConflict((oc) => oc.column('agent_id').doNothing())
					.execute();

				// Migrate agent iterations
				const iterationsSnapshot = await this.firestoreDb.collection('AgentContext').doc(doc.id).collection('Iterations').get();

				for (const iterDoc of iterationsSnapshot.docs) {
					const iterData = iterDoc.data();
					await db
						.insertInto('agent_iterations')
						.values({
							agent_id: doc.id,
							iteration_number: Number.parseInt(iterDoc.id, 10),
							functions_serialized: iterData.functions ? JSON.stringify(iterData.functions) : null,
							prompt: iterData.prompt || null,
							response: iterData.response || null,
							summary: iterData.summary || null,
							expanded_user_request: iterData.expandedUserRequest || null,
							observations_reasoning: iterData.observationsReasoning || null,
							agent_plan: iterData.agentPlan || null,
							next_step_details: iterData.nextStepDetails || null,
							code: iterData.code || null,
							executed_code: iterData.executedCode || null,
							draft_code: iterData.draftCode || null,
							code_review: iterData.codeReview || null,
							images_serialized: iterData.images ? JSON.stringify(iterData.images) : null,
							function_calls_serialized: iterData.functionCalls ? JSON.stringify(iterData.functionCalls) : null,
							memory_serialized: iterData.memory ? JSON.stringify(iterData.memory) : null,
							tool_state_serialized: iterData.toolState ? JSON.stringify(iterData.toolState) : null,
							error: iterData.error || null,
							stats_serialized: iterData.stats ? JSON.stringify(iterData.stats) : null,
							cost: iterData.cost || null,
							created_at: iterData.createdAt?.toDate() || new Date(),
						})
						.onConflict((oc) => oc.columns(['agent_id', 'iteration_number']).doNothing())
						.execute();
				}

				stats.migrated++;
			} catch (error: any) {
				stats.errors++;
				stats.errorDetails.push({ id: doc.id, error: error.message });
				logger.error(error, { agentId: doc.id }, 'Error migrating agent context [agentId]');
			}
		}
	}

	async migrateLlmCalls(): Promise<void> {
		logger.info('Migrating LlmCall collection...');
		const stats = this.initStats('LlmCall');

		const snapshot = await this.firestoreDb.collection('LlmCall').get();
		stats.total = snapshot.size;

		for (const doc of snapshot.docs) {
			try {
				const data = doc.data();

				// Skip chunk documents
				if (data.chunkIndex !== undefined) {
					stats.skipped++;
					continue;
				}

				if (this.options.dryRun) {
					logger.info({ llmCallId: doc.id }, 'Would migrate LLM call [llmCallId]');
					stats.migrated++;
					continue;
				}

				await db
					.insertInto('llm_calls')
					.values({
						id: doc.id,
						description: data.description || null,
						messages_serialized: JSON.stringify(data.messages || []),
						settings_serialized: JSON.stringify(data.settings || {}),
						request_time: data.requestTime?.toDate() || new Date(),
						agent_id: data.agentId || null,
						user_id: data.userId || null,
						call_stack: data.callStack ? JSON.stringify(data.callStack) : null,
						time_to_first_token: data.timeToFirstToken || null,
						total_time: data.totalTime || null,
						cost: data.cost || null,
						input_tokens: data.inputTokens || null,
						output_tokens: data.outputTokens || null,
						cached_input_tokens: data.cachedInputTokens || null,
						error: data.error || null,
						llm_id: data.llmId || null,
					})
					.onConflict((oc) => oc.column('id').doNothing())
					.execute();

				stats.migrated++;
			} catch (error: any) {
				stats.errors++;
				stats.errorDetails.push({ id: doc.id, error: error.message });
				logger.error(error, { llmCallId: doc.id }, 'Error migrating LLM call [llmCallId]');
			}
		}
	}

	async migratePrompts(): Promise<void> {
		logger.info('Migrating Prompts collection...');
		const stats = this.initStats('Prompts');

		const snapshot = await this.firestoreDb.collection('Prompts').get();
		stats.total = snapshot.size;

		for (const doc of snapshot.docs) {
			try {
				const data = doc.data();

				if (this.options.dryRun) {
					logger.info({ promptId: doc.id }, 'Would migrate prompt [promptId]');
					stats.migrated++;
					continue;
				}

				// Migrate prompt group
				await db
					.insertInto('prompt_groups')
					.values({
						id: doc.id,
						user_id: data.userId,
						latest_revision_id: data.latestRevisionId || 1,
						name: data.name,
						app_id: data.appId || null,
						tags_serialized: JSON.stringify(data.tags || []),
						parent_id: data.parentId || null,
						settings_serialized: JSON.stringify(data.options || {}),
						created_at: data.createdAt?.toDate() || new Date(),
						updated_at: data.updatedAt?.toDate() || new Date(),
					})
					.onConflict((oc) => oc.column('id').doNothing())
					.execute();

				// Migrate prompt revisions
				const revisionsSnapshot = await this.firestoreDb.collection('Prompts').doc(doc.id).collection('Revisions').get();

				for (const revDoc of revisionsSnapshot.docs) {
					const revData = revDoc.data();
					await db
						.insertInto('prompt_revisions')
						.values({
							id: `${doc.id}-rev-${revDoc.id}`,
							prompt_group_id: doc.id,
							revision_number: Number.parseInt(revDoc.id, 10),
							name: revData.name,
							app_id: revData.appId || null,
							tags_serialized: JSON.stringify(revData.tags || []),
							parent_id: revData.parentId || null,
							messages_serialized: JSON.stringify(revData.messages || []),
							settings_serialized: JSON.stringify(revData.options || {}),
							created_at: revData.createdAt?.toDate() || new Date(),
						})
						.onConflict((oc) => oc.column('id').doNothing())
						.execute();
				}

				stats.migrated++;
			} catch (error: any) {
				stats.errors++;
				stats.errorDetails.push({ id: doc.id, error: error.message });
				logger.error(error, { promptId: doc.id }, 'Error migrating prompt [promptId]');
			}
		}
	}

	async migrateCodeTasks(): Promise<void> {
		logger.info('Migrating CodeTask collection...');
		const stats = this.initStats('CodeTask');

		const snapshot = await this.firestoreDb.collectionGroup('CodeTask').get();
		stats.total = snapshot.size;

		for (const doc of snapshot.docs) {
			try {
				const data = doc.data();

				if (this.options.dryRun) {
					logger.info({ codeTaskId: doc.id }, 'Would migrate code task [codeTaskId]');
					stats.migrated++;
					continue;
				}

				await db
					.insertInto('code_task_sessions')
					.values({
						id: doc.id,
						user_id: data.userId,
						title: data.title,
						instructions: data.instructions,
						repository_source: data.repositorySource,
						repository_id: data.repositoryId,
						repository_name: data.repositoryName || null,
						target_branch: data.targetBranch,
						working_branch: data.workingBranch,
						create_working_branch: data.createWorkingBranch ?? false,
						use_shared_repos: data.useSharedRepos ?? false,
						status: data.status,
						last_agent_activity: data.lastAgentActivity || Date.now(),
						file_selection_serialized: data.fileSelection ? JSON.stringify(data.fileSelection) : null,
						original_file_selection_for_review_serialized: data.originalFileSelectionForReview
							? JSON.stringify(data.originalFileSelectionForReview)
							: null,
						design_answer_serialized: data.designAnswer ? JSON.stringify(data.designAnswer) : null,
						selected_variations: data.selectedVariations || null,
						code_diff: data.codeDiff || null,
						commit_sha: data.commitSha || null,
						pull_request_url: data.pullRequestUrl || null,
						ci_cd_status: data.ciCdStatus || null,
						ci_cd_job_url: data.ciCdJobUrl || null,
						ci_cd_analysis: data.ciCdAnalysis || null,
						ci_cd_proposed_fix: data.ciCdProposedFix || null,
						created_at: data.createdAt || Date.now(),
						updated_at: data.updatedAt || Date.now(),
						agent_history_serialized: data.agentHistory ? JSON.stringify(data.agentHistory) : null,
						error_message: data.error || null,
					})
					.onConflict((oc) => oc.column('id').doNothing())
					.execute();

				stats.migrated++;
			} catch (error: any) {
				stats.errors++;
				stats.errorDetails.push({ id: doc.id, error: error.message });
				logger.error(error, { codeTaskId: doc.id }, 'Error migrating code task [codeTaskId]');
			}
		}
	}

	printSummary(): void {
		logger.info('\n========================================');
		logger.info('Migration Summary');
		logger.info('========================================\n');

		let totalRecords = 0;
		let totalMigrated = 0;
		let totalSkipped = 0;
		let totalErrors = 0;

		for (const [collection, stats] of this.stats.entries()) {
			logger.info(`${collection}:`);
			logger.info(`  Total: ${stats.total}`);
			logger.info(`  Migrated: ${stats.migrated}`);
			logger.info(`  Skipped: ${stats.skipped}`);
			logger.info(`  Errors: ${stats.errors}`);

			if (stats.errors > 0) {
				logger.info(`  Error details:`);
				for (const error of stats.errorDetails.slice(0, 5)) {
					logger.error(`    - ${error.id}: ${error.error}`);
				}
				if (stats.errorDetails.length > 5) {
					logger.info(`    ... and ${stats.errorDetails.length - 5} more errors`);
				}
			}
			logger.info('');

			totalRecords += stats.total;
			totalMigrated += stats.migrated;
			totalSkipped += stats.skipped;
			totalErrors += stats.errors;
		}

		logger.info('========================================');
		logger.info('Overall Totals:');
		logger.info(`  Total Records: ${totalRecords}`);
		logger.info(`  Migrated: ${totalMigrated}`);
		logger.info(`  Skipped: ${totalSkipped}`);
		logger.info(`  Errors: ${totalErrors}`);
		logger.info('========================================\n');

		if (this.options.dryRun) {
			logger.info('DRY RUN - No data was actually migrated');
		}
	}

	async migrate(): Promise<void> {
		try {
			logger.info('Starting Firestore to PostgreSQL migration...');
			logger.info(`Dry run: ${this.options.dryRun}`);
			logger.info(`Batch size: ${this.options.batchSize}`);

			if (!this.options.dryRun) {
				logger.info('Ensuring all tables exist...');
				await ensureAllTablesExist(db);
			}

			if (this.options.collection) {
				logger.info(`Migrating only collection: ${this.options.collection}`);
				switch (this.options.collection) {
					case 'Users':
						await this.migrateUsers();
						break;
					case 'Chats':
						await this.migrateChats();
						break;
					case 'AgentContext':
						await this.migrateAgentContexts();
						break;
					case 'LlmCall':
						await this.migrateLlmCalls();
						break;
					case 'Prompts':
						await this.migratePrompts();
						break;
					case 'CodeTask':
						await this.migrateCodeTasks();
						break;
					default:
						logger.error(`Unknown collection: ${this.options.collection}`);
						process.exit(1);
				}
			} else {
				// Migrate all collections
				await this.migrateUsers();
				await this.migrateChats();
				await this.migrateAgentContexts();
				await this.migrateLlmCalls();
				await this.migratePrompts();
				await this.migrateCodeTasks();
			}

			this.printSummary();

			if (!this.options.dryRun) {
				logger.info('Migration completed successfully!');
			} else {
				logger.info('Dry run completed. Use without --dry-run to perform actual migration.');
			}
		} catch (error) {
			logger.error(error, 'Migration failed:');
			process.exit(1);
		}
	}
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: MigrationOptions = {
	dryRun: args.includes('--dry-run'),
	batchSize: 100,
};

for (const arg of args) {
	if (arg.startsWith('--collection=')) {
		options.collection = arg.split('=')[1];
	} else if (arg.startsWith('--batch-size=')) {
		options.batchSize = Number.parseInt(arg.split('=')[1], 10);
	}
}

// Run migration
const migrator = new FirestoreToPostgresMigrator(options);
migrator.migrate().catch((error) => {
	logger.error(error, 'Unexpected error during migration:');
	process.exit(1);
});
