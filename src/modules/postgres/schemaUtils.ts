import { type Kysely, sql } from 'kysely';
import type { Database } from './db';

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
