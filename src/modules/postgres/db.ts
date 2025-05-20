import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { envVar } from '#utils/env-var';

import type { ColumnType } from 'kysely';

// Define table interfaces for Kysely

export interface AgentContextsTable {
	agent_id: string; // PRIMARY KEY
	execution_id: string;
	typed_ai_repo_dir: string | null;
	trace_id: string;
	name: string | null;
	parent_agent_id: string | null;
	user_id: string; // Foreign key to a potential users table, or just stores the ID
	state: string; // Represents AgentRunningState
	call_stack: string[] | null; // Stored as JSONB
	error: string | null;
	hil_budget: number | null;
	hil_count: number | null;
	cost: number;
	budget_remaining: number | null;
	llms_serialized: Record<string, any>; // Serialized AgentLLMs as JSONB
	use_shared_repos: boolean | null;
	memory_serialized: Record<string, any>; // AgentContext['memory'] as JSONB
	last_update: ColumnType<Date, string | Date, string | Date>;
	metadata_serialized: Record<string, any> | null; // AgentContext['metadata'] as JSONB
	functions_serialized: Record<string, any>; // Serialized LlmFunctionsImpl as JSONB
	completed_handler_id: string | null;
	pending_messages_serialized: any[] | null; // PendingMessage[] as JSONB
	type: string; // AgentType
	subtype: string | null;
	iterations: number; // Current iteration count for the agent
	invoking_serialized: any[] | null; // InvokingAgentInfo[] as JSONB
	notes_serialized: string[] | null; // string[] as JSONB
	user_prompt: string | null;
	input_prompt: string;
	messages_serialized: any[]; // ChatMessage[] as JSONB
	function_call_history_serialized: any[] | null; // FunctionCallResult[] as JSONB
	live_files_serialized: string[] | null; // string[] as JSONB
	child_agents_ids: string[] | null; // string[] as JSONB for child agent IDs
	hil_requested: boolean | null;
	created_at: ColumnType<Date, string | Date, string | Date>;
}

export interface AgentIterationsTable {
	agent_id: string; // FK to agent_contexts.agent_id
	iteration_number: number; // Part of composite PK
	functions_serialized: string[] | null; // Function class names as JSONB array
	prompt: string | null;
	summary: string | null;
	expanded_user_request: string | null;
	observations_reasoning: string | null;
	agent_plan: string | null;
	next_step_details: string | null;
	code: string | null;
	executed_code: string | null;
	draft_code: string | null;
	code_review: string | null;
	images_serialized: any[] | null; // Serialized ImagePromptContentPart[] as JSONB
	function_calls_serialized: any[] | null; // Serialized FunctionCallResult[] as JSONB
	memory_serialized: Record<string, string> | null; // from Map<string, string> as JSONB
	tool_state_serialized: Record<string, any> | null; // from Map<string, any> as JSONB
	error: string | null;
	stats_serialized: Record<string, any> | null; // GenerationStats as JSONB
	cost: number | null;
	created_at: ColumnType<Date, string | Date, string | Date>;
	// PRIMARY KEY (agent_id, iteration_number)
}

// Define the database schema.
// This will be populated with table types as services are implemented.
export interface ChatsTable {
	id: string; // PRIMARY KEY
	user_id: string;
	title: string;
	updated_at: ColumnType<Date, string | Date, string | Date>;
	shareable: boolean;
	parent_id: string | null;
	root_id: string | null;
	messages_serialized: ColumnType<string, string, string>; // JSONB stored as string representing ChatMessage[]
	created_at: ColumnType<Date, string | Date, string | Date>;
}

export interface Database {
	agent_contexts: AgentContextsTable;
	agent_iterations: AgentIterationsTable;
	chats: ChatsTable;
}

const dialect = new PostgresDialect({
	pool: new Pool({
		host: envVar('POSTGRES_HOST', 'localhost'),
		port: Number.parseInt(envVar('POSTGRES_PORT', '5432'), 10),
		user: envVar('POSTGRES_USER', 'user'),
		password: envVar('POSTGRES_PASSWORD', 'password'),
		database: envVar('POSTGRES_DB', 'db'),
		max: 10, // Max number of clients in the pool
	}),
});

// Create and export the Kysely instance
// This db instance will be imported by Postgres service implementations.
export const db = new Kysely<Database>({
	dialect,
});
