import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { envVar } from '#utils/env-var';

// Define an empty interface for the database schema.
// This will be populated with table types as services are implemented.
export type Database = {};

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
