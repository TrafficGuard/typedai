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
