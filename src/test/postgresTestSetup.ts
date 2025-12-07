import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ensurePostgresDockerRunning } from '#modules/postgres/ensureDockerPostgres';
import { logger } from '#o11y/logger';

const execAsync = promisify(exec);

async function ensureTestDatabaseExists(): Promise<void> {
	const containerName = 'typedai-postgres';

	try {
		// Check if 'test' database exists
		const { stdout } = await execAsync(`docker exec ${containerName} psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='test'"`);

		if (stdout.trim() !== '1') {
			logger.info('Creating test database...');
			await execAsync(`docker exec ${containerName} psql -U postgres -c "CREATE DATABASE test;"`);
			logger.info('Test database created');
		}
	} catch (error) {
		logger.error(error, 'Failed to ensure test database exists');
		throw error;
	}
}

// Mocha root hooks - these run before/after all tests
export const mochaHooks = {
	async beforeAll() {
		await ensurePostgresDockerRunning();
		await ensureTestDatabaseExists();
	},
};
