import { type Kysely, sql } from 'kysely';
import type { Database } from './db';

export async function createUsersTable(dbInstance: Kysely<Database>): Promise<void> {
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
