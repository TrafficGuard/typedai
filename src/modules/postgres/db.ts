import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { envVar } from '#utils/env-var';

import type { ColumnType } from 'kysely';

// Define table interfaces for Kysely

export interface AgentContextsTable {
	agent_id: string; // PRIMARY KEY
	execution_id: string;
	container_id: string | null;
	typed_ai_repo_dir: string;
	trace_id: string;
	name: string | null;
	parent_agent_id: string | null;
	user_id: string; // Foreign key to a potential users table, or just stores the ID
	state: string; // Represents AgentRunningState
	call_stack: string | null; // Stored as JSONB, was string[] | null
	error: string | null;
	hil_budget: number | null;
	hil_count: number | null;
	cost: number;
	budget_remaining: number | null;
	llms_serialized: string; // Serialized AgentLLMs as JSONB, was Record<string, any>
	use_shared_repos: boolean | null;
	memory_serialized: string; // AgentContext['memory'] as JSONB, was Record<string, any>
	last_update: ColumnType<Date, string | Date, string | Date>;
	metadata_serialized: string | null; // AgentContext['metadata'] as JSONB, was Record<string, any> | null
	functions_serialized: string; // Serialized LlmFunctionsImpl as JSONB, was Record<string, any>
	completed_handler_id: string | null;
	pending_messages_serialized: string | null; // PendingMessage[] as JSONB, was any[] | null
	type: string; // AgentType
	subtype: string | null;
	iterations: number; // Current iteration count for the agent
	invoking_serialized: string | null; // InvokingAgentInfo[] as JSONB, was any[] | null
	notes_serialized: string | null; // string[] as JSONB, was string[] | null
	user_prompt: string | null;
	input_prompt: string;
	messages_serialized: string; // ChatMessage[] as JSONB, was any[]
	function_call_history_serialized: string | null; // FunctionCallResult[] as JSONB, was any[] | null
	live_files_serialized: string | null; // string[] as JSONB, was string[] | null
	child_agents_ids: string | null; // string[] as JSONB for child agent IDs, was string[] | null
	hil_requested: boolean | null;
	created_at: ColumnType<Date, string | Date, string | Date>;
}

// Suggested DDL constraint: UNIQUE (scope, scope_identifier, cache_key_hash)
export interface FunctionCacheTable {
	id: string; // PRIMARY KEY
	scope: string;
	scope_identifier: string | null;
	cache_key_hash: string;
	value_json: string; // TEXT or JSONB
	created_at: ColumnType<Date, string | Date, string | Date>; // TIMESTAMPTZ, default NOW()
	expires_at: ColumnType<Date, string | Date, string | Date> | null; // TIMESTAMPTZ, nullable
}

export interface CodeReviewConfigsTable {
	id: string; // PRIMARY KEY
	title: string;
	description: string | null;
	enabled: boolean;
	file_extensions_serialized: string | null; // JSON CodeReviewFileExtensions
	requires_serialized: string | null; // JSON CodeReviewRequires
	tags_serialized: string | null; // JSON string[]
	project_paths_serialized: string | null; // JSON string[]
	examples_serialized: string | null; // JSON CodeReviewExample[]
	created_at: ColumnType<Date, string | undefined, never>; // Default in DB
	updated_at: ColumnType<Date, string | undefined, string | undefined>; // Default/updated in DB
}

export interface MergeRequestReviewCacheTable {
	project_id: string; // Part of composite PK
	mr_iid: number; // Part of composite PK
	last_updated: ColumnType<Date, string | Date, string | Date>;
	fingerprints_serialized: string | null; // JSON string[]
	created_at: ColumnType<Date, string | undefined, never>; // Default in DB
	updated_at: ColumnType<Date, string | undefined, string | undefined>; // Default/updated in DB
	// PRIMARY KEY (project_id, mr_iid)
}

export interface AgentIterationsTable {
	agent_id: string; // FK to agent_contexts.agent_id
	iteration_number: number; // Part of composite PK
	functions_serialized: string | null; // Function class names as JSONB array, was string[] | null
	prompt: string | null;
	response: string | null;
	summary: string | null;
	expanded_user_request: string | null;
	observations_reasoning: string | null;
	agent_plan: string | null;
	next_step_details: string | null;
	code: string | null;
	executed_code: string | null;
	draft_code: string | null;
	code_review: string | null;
	images_serialized: string | null; // Serialized ImagePromptContentPart[] as JSONB, was any[] | null
	function_calls_serialized: string | null; // Serialized FunctionCallResult[] as JSONB, was any[] | null
	memory_serialized: string | null; // from Map<string, string> as JSONB, was Record<string, string> | null
	tool_state_serialized: string | null; // from Map<string, any> as JSONB, was Record<string, any> | null
	error: string | null;
	stats_serialized: string | null; // GenerationStats as JSONB, was Record<string, any> | null
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

export interface UsersTable {
	id: string; // PRIMARY KEY
	name: string | null;
	email: string; // Should be unique
	enabled: boolean; // Default true
	admin: boolean; // Default false
	password_hash: string | null;
	hil_budget: number; // Default 0
	hil_count: number; // Default 0
	last_login_at: ColumnType<Date, string | Date, string | Date> | null;
	created_at: ColumnType<Date, string | Date, string | Date>; // Default to current timestamp
	llm_config_serialized: string | null; // JSON string of User['llmConfig']
	chat_config_serialized: string | null; // JSON string of User['chat']
	function_config_serialized: string | null; // JSON string of User['functionConfig']
}

export interface CodeTasksTable {
	id: string; // PRIMARY KEY (UUID)
	user_id: string; // Foreign key to users.id
	title: string;
	instructions: string;
	repository_source: string; // 'local' | 'github' | 'gitlab'
	repository_id: string;
	repository_name: string | null;
	target_branch: string;
	working_branch: string;
	create_working_branch: boolean;
	use_shared_repos: boolean;
	status: string; // CodeTaskStatus
	last_agent_activity: number; // BigInt or Numeric in DB, maps to number (timestamp)
	file_selection_serialized: string | null; // JSON string of SelectedFile[]
	original_file_selection_for_review_serialized: string | null; // JSON string of SelectedFile[]
	design_answer_serialized: string | null; // JSON string of DesignAnswer
	selected_variations: number | null;
	code_diff: string | null;
	commit_sha: string | null;
	pull_request_url: string | null;
	ci_cd_status: string | null; // 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
	ci_cd_job_url: string | null;
	ci_cd_analysis: string | null;
	ci_cd_proposed_fix: string | null;
	created_at: number; // BigInt or Numeric in DB, maps to number (timestamp)
	updated_at: number; // BigInt or Numeric in DB, maps to number (timestamp)
	agent_history_serialized: string | null; // JSON string of string[]
	error_message: string | null; // Renamed from 'error' to avoid SQL keyword conflict
}

export interface CodeTaskPresetsTable {
	id: string; // PRIMARY KEY (UUID)
	user_id: string; // Foreign key to users.id
	name: string;
	config_serialized: string; // JSON string of CodeTaskPresetConfig
	created_at: number; // BigInt or Numeric in DB, maps to number (timestamp)
	updated_at: number; // BigInt or Numeric in DB, maps to number (timestamp)
}

// Add this new interface
export interface LlmCallsTable {
	id: string; // PRIMARY KEY
	description: string | null;
	messages_serialized: string; // JSON string of LlmMessage[]
	settings_serialized: string; // JSON string of CallSettings
	request_time: ColumnType<Date, string | Date, string | Date>; // TIMESTAMPTZ
	agent_id: string | null;
	user_id: string | null;
	call_stack: string | null; // JSON string of string[]
	time_to_first_token: number | null;
	total_time: number | null;
	cost: number | null;
	input_tokens: number | null;
	output_tokens: number | null;
	cached_input_tokens: number | null;
	error: string | null;
	llm_id: string | null; // To store the llm_id from the response for easier querying
	// Standard audit columns, assuming DB defaults for created_at and auto-updates updated_at
	created_at: ColumnType<Date, string | undefined, never>;
	updated_at: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PromptGroupsTable {
	id: string; // PRIMARY KEY (UUID)
	user_id: string; // Foreign key to users.id
	latest_revision_id: number; // Integer, refers to revision_number in PromptRevisionsTable
	name: string;
	app_id: string | null;
	tags_serialized: string; // JSON string of string[]
	parent_id: string | null; // Foreign key to prompt_groups.id (for branching)
	settings_serialized: string; // JSON string of (CallSettings & { llmId?: string })
	created_at: ColumnType<Date, string | undefined, never>; // Default in DB
	updated_at: ColumnType<Date, string | undefined, string | undefined>; // Default/updated in DB
}

export interface PromptRevisionsTable {
	id: string; // PRIMARY KEY (UUID for the revision record itself)
	prompt_group_id: string; // Foreign key to prompt_groups.id
	revision_number: number; // Integer, e.g., 1, 2, 3...
	name: string;
	app_id: string | null;
	tags_serialized: string; // JSON string of string[]
	parent_id: string | null; // Denormalized from prompt_groups.parent_id at time of revision
	messages_serialized: string; // JSON string of LlmMessage[]
	settings_serialized: string; // JSON string of (CallSettings & { llmId?: string })
	created_at: ColumnType<Date, string | undefined, never>; // Default in DB
	// Consider adding: UNIQUE (prompt_group_id, revision_number)
}

export interface CICDStatsTable {
	id: string; // PRIMARY KEY (UUID)
	build_id: number;
	project: string;
	status: string;
	job_name: string;
	stage: string;
	started_at: string; // ISO timestamp string
	duration: number;
	pipeline: number;
	host: string;
	failure_reason: string | null;
	failure_type: string | null;
	created_at: ColumnType<Date, string | undefined, never>; // Default in DB
}

export interface Database {
	agent_contexts: AgentContextsTable;
	agent_iterations: AgentIterationsTable;
	chats: ChatsTable;
	code_review_configs: CodeReviewConfigsTable;
	merge_request_review_cache: MergeRequestReviewCacheTable;
	function_cache: FunctionCacheTable;
	users: UsersTable;
	code_task_sessions: CodeTasksTable;
	code_task_presets: CodeTaskPresetsTable;
	llm_calls: LlmCallsTable;
	prompt_groups: PromptGroupsTable;
	prompt_revisions: PromptRevisionsTable;
	cicd_stats: CICDStatsTable;
}

const dialect = new PostgresDialect({
	pool: new Pool({
		host: envVar('DATABASE_HOST', 'localhost'),
		port: Number.parseInt(envVar('DATABASE_PORT', '5432'), 10),
		user: envVar('DATABASE_USER', 'user'),
		password: envVar('DATABASE_PASSWORD', 'password'),
		database: process.env.NODE_ENV === 'test' ? 'test' : process.env.DATABASE_NAME,
		max: 10, // Max number of clients in the pool
	}),
});

// Create and export the Kysely instance
// This db instance will be imported by Postgres service implementations.
export const db = new Kysely<Database>({
	dialect,
});
