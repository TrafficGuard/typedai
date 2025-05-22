import { type Kysely, sql } from 'kysely';
import { type Database, db } from './db'; // Import db here

export async function ensureUsersTableExists(dbInstance: Kysely<Database>): Promise<void> {
	await dbInstance.schema
		.createTable('users')
		.ifNotExists()
		.addColumn('id', 'text', (col) => col.primaryKey())
		.addColumn('name', 'text')
		.addColumn('email', 'text', (col) => col.notNull().unique())
		.addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
		.addColumn('password_hash', 'text')
		.addColumn('hil_budget', 'integer', (col) => col.notNull().defaultTo(0))
		.addColumn('hil_count', 'integer', (col) => col.notNull().defaultTo(0))
		.addColumn('last_login_at', 'timestamptz')
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('llm_config_serialized', 'text')
		.addColumn('chat_config_serialized', 'text')
		.addColumn('function_config_serialized', 'text')
		.execute();
}

export async function ensureChatsTableExists(dbInstance: Kysely<Database>): Promise<void> {
	await dbInstance.schema
		.createTable('chats')
		.ifNotExists()
		.addColumn('id', 'text', (col) => col.primaryKey())
		.addColumn('user_id', 'text', (col) => col.notNull())
		.addColumn('title', 'text', (col) => col.notNull())
		.addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('shareable', 'boolean', (col) => col.notNull().defaultTo(false))
		.addColumn('parent_id', 'text')
		.addColumn('root_id', 'text')
		.addColumn('messages_serialized', 'text', (col) => col.notNull())
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();
}

export async function ensureAgentContextsTableExists(dbInstance: Kysely<Database>): Promise<void> {
	await dbInstance.schema
		.createTable('agent_contexts')
		.ifNotExists()
		.addColumn('agent_id', 'text', (col) => col.primaryKey())
		.addColumn('execution_id', 'text', (col) => col.notNull())
		.addColumn('typed_ai_repo_dir', 'text')
		.addColumn('trace_id', 'text', (col) => col.notNull())
		.addColumn('name', 'text')
		.addColumn('parent_agent_id', 'text')
		.addColumn('user_id', 'text', (col) => col.notNull())
		.addColumn('state', 'text', (col) => col.notNull())
		.addColumn('call_stack', 'jsonb') // For string[]
		.addColumn('error', 'text')
		.addColumn('hil_budget', 'numeric')
		.addColumn('hil_count', 'integer')
		.addColumn('cost', 'numeric', (col) => col.notNull())
		.addColumn('budget_remaining', 'numeric')
		.addColumn('llms_serialized', 'jsonb', (col) => col.notNull()) // For Record<string, any>
		.addColumn('use_shared_repos', 'boolean')
		.addColumn('memory_serialized', 'jsonb', (col) => col.notNull()) // For Record<string, any>
		.addColumn('last_update', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('metadata_serialized', 'jsonb') // For Record<string, any> | null
		.addColumn('functions_serialized', 'jsonb', (col) => col.notNull()) // For Record<string, any>
		.addColumn('completed_handler_id', 'text')
		.addColumn('pending_messages_serialized', 'jsonb') // For any[] | null
		.addColumn('type', 'text', (col) => col.notNull())
		.addColumn('subtype', 'text')
		.addColumn('iterations', 'integer', (col) => col.notNull())
		.addColumn('invoking_serialized', 'jsonb') // For any[] | null
		.addColumn('notes_serialized', 'jsonb') // For string[] | null
		.addColumn('user_prompt', 'text')
		.addColumn('input_prompt', 'text', (col) => col.notNull())
		.addColumn('messages_serialized', 'jsonb', (col) => col.notNull()) // For any[]
		.addColumn('function_call_history_serialized', 'jsonb') // For any[] | null
		.addColumn('live_files_serialized', 'jsonb') // For string[] | null
		.addColumn('child_agents_ids', 'jsonb') // For string[] | null
		.addColumn('hil_requested', 'boolean')
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();
}

export async function ensureAgentIterationsTableExists(dbInstance: Kysely<Database>): Promise<void> {
	await dbInstance.schema
		.createTable('agent_iterations')
		.ifNotExists()
		.addColumn('agent_id', 'text', (col) => col.notNull())
		.addColumn('iteration_number', 'integer', (col) => col.notNull())
		.addColumn('functions_serialized', 'jsonb') // For string[] | null
		.addColumn('prompt', 'text')
		.addColumn('summary', 'text')
		.addColumn('expanded_user_request', 'text')
		.addColumn('observations_reasoning', 'text')
		.addColumn('agent_plan', 'text')
		.addColumn('next_step_details', 'text')
		.addColumn('code', 'text')
		.addColumn('executed_code', 'text')
		.addColumn('draft_code', 'text')
		.addColumn('code_review', 'text')
		.addColumn('images_serialized', 'jsonb') // For any[] | null
		.addColumn('function_calls_serialized', 'jsonb') // For any[] | null
		.addColumn('memory_serialized', 'jsonb') // For Record<string, string> | null
		.addColumn('tool_state_serialized', 'jsonb') // For Record<string, any> | null
		.addColumn('error', 'text')
		.addColumn('stats_serialized', 'jsonb') // For Record<string, any> | null
		.addColumn('cost', 'numeric')
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		// Define composite primary key
		.addPrimaryKeyConstraint('agent_iterations_pkey', ['agent_id', 'iteration_number'])
		// Define foreign key to agent_contexts table
		.addForeignKeyConstraint(
			'agent_iterations_agent_id_fkey', // Constraint name
			['agent_id'], // Column(s) in this table
			'agent_contexts', // Foreign table
			['agent_id'], // Column(s) in foreign table
			(cb) => cb.onDelete('cascade'), // Add ON DELETE CASCADE
		)
		.execute();
}

export async function ensureVibeTablesExist(): Promise<void> {
	// Vibe Sessions Table
	await db.schema
		.createTable('vibe_sessions')
		.ifNotExists()
		.addColumn('id', 'text', (col) => col.primaryKey())
		.addColumn('user_id', 'text', (col) => col.notNull())
		.addColumn('title', 'text', (col) => col.notNull())
		.addColumn('instructions', 'text', (col) => col.notNull())
		.addColumn('repository_source', 'text', (col) => col.notNull())
		.addColumn('repository_id', 'text', (col) => col.notNull())
		.addColumn('repository_name', 'text')
		.addColumn('target_branch', 'text', (col) => col.notNull())
		.addColumn('working_branch', 'text', (col) => col.notNull())
		.addColumn('create_working_branch', 'boolean', (col) => col.notNull())
		.addColumn('use_shared_repos', 'boolean', (col) => col.notNull())
		.addColumn('status', 'text', (col) => col.notNull())
		.addColumn('last_agent_activity', 'bigint', (col) => col.notNull()) // Storing as bigint for JS number (Date.now())
		.addColumn('file_selection_serialized', 'text')
		.addColumn('original_file_selection_for_review_serialized', 'text')
		.addColumn('design_answer_serialized', 'text')
		.addColumn('selected_variations', 'integer')
		.addColumn('code_diff', 'text')
		.addColumn('commit_sha', 'text')
		.addColumn('pull_request_url', 'text')
		.addColumn('ci_cd_status', 'text')
		.addColumn('ci_cd_job_url', 'text')
		.addColumn('ci_cd_analysis', 'text')
		.addColumn('ci_cd_proposed_fix', 'text')
		.addColumn('created_at', 'bigint', (col) => col.notNull()) // Storing as bigint for JS number (Date.now())
		.addColumn('updated_at', 'bigint', (col) => col.notNull()) // Storing as bigint for JS number (Date.now())
		.addColumn('agent_history_serialized', 'text')
		.addColumn('error_message', 'text')
		.execute();

	// Vibe Presets Table
	await db.schema
		.createTable('vibe_presets')
		.ifNotExists()
		.addColumn('id', 'text', (col) => col.primaryKey())
		.addColumn('user_id', 'text', (col) => col.notNull())
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('config_serialized', 'text', (col) => col.notNull())
		.addColumn('created_at', 'bigint', (col) => col.notNull()) // Storing as bigint for JS number (Date.now())
		.addColumn('updated_at', 'bigint', (col) => col.notNull()) // Storing as bigint for JS number (Date.now())
		.execute();
}

export async function ensureLlmCallsTableExists(dbInstance: Kysely<Database> = db): Promise<void> {
	await dbInstance.schema
		.createTable('llm_calls')
		.ifNotExists()
		.addColumn('id', 'text', (col) => col.primaryKey())
		.addColumn('description', 'text')
		.addColumn('messages_serialized', 'text', (col) => col.notNull())
		.addColumn('settings_serialized', 'text', (col) => col.notNull())
		.addColumn('request_time', 'timestamptz', (col) => col.notNull())
		.addColumn('agent_id', 'text')
		.addColumn('user_id', 'text')
		.addColumn('call_stack', 'text') // LlmCallsTable in db.ts has this as string | null
		.addColumn('time_to_first_token', 'integer')
		.addColumn('total_time', 'integer')
		.addColumn('cost', 'double precision')
		.addColumn('input_tokens', 'integer')
		.addColumn('output_tokens', 'integer')
		.addColumn('cached_input_tokens', 'integer') // As per LlmCallsTable in db.ts
		.addColumn('error', 'text')
		.addColumn('llm_id', 'text')
		// created_at and updated_at are defined in LlmCallsTable with specific ColumnType
		// indicating DB defaults.
		.addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
		.addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
		.execute();

	// Optional: Add a trigger for 'updated_at' if your database doesn't automatically update it on row changes.
	// Many applications handle this at the application layer or rely on database features.
	// Example for Postgres (if not already handled):
	// try {
	// 	await dbInstance.raw(sql`
	// 		CREATE OR REPLACE FUNCTION update_updated_at_column()
	// 		RETURNS TRIGGER AS $$
	// 		BEGIN
	// 			NEW.updated_at = now();
	// 			RETURN NEW;
	// 		END;
	// 		$$ language 'plpgsql';
	// 	`).execute();
	//
	// 	await dbInstance.raw(sql`
	// 		DROP TRIGGER IF EXISTS update_llm_calls_updated_at ON llm_calls;
	// 	`).execute();
	//
	// 	await dbInstance.raw(sql`
	// 		CREATE TRIGGER update_llm_calls_updated_at
	// 		BEFORE UPDATE ON llm_calls
	// 		FOR EACH ROW
	// 		EXECUTE FUNCTION update_updated_at_column();
	// 	`).execute();
	// } catch (error) {
	// 	// Ignore error if trigger or function already exists, or handle more gracefully
	// 	// console.warn("Could not create/update trigger for updated_at on llm_calls:", error);
	// }
}
