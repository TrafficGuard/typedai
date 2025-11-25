import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '#o11y/logger';
import { envVar } from '#utils/env-var';

const execAsync = promisify(exec);

/**
 * Ensures the Postgres Docker container is running for local development.
 * Automatically starts the container if needed using docker compose.
 *
 * Skips if:
 * - Running inside Docker (DOCKER_CONTAINER=true)
 * - Running in CI (CI=true)
 * - Database host is not localhost
 * - Docker is not available
 */
export async function ensurePostgresDockerRunning(): Promise<void> {
	// Skip if running inside Docker
	if (process.env.DOCKER_CONTAINER === 'true') {
		logger.debug('Running inside Docker, skipping Postgres container check');
		return;
	}

	// Skip if running in CI
	if (process.env.CI === 'true') {
		logger.debug('Running in CI, skipping Postgres container check');
		return;
	}

	// Skip if database host is not localhost
	const dbHost = envVar('DATABASE_HOST', 'localhost');
	if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
		logger.debug({ dbHost }, 'Database host is not localhost, skipping container check [dbHost]');
		return;
	}

	try {
		// Check if Docker is available
		try {
			await execAsync('docker --version');
		} catch {
			logger.warn('Docker not available. Please install Docker or set DATABASE_HOST to an external Postgres instance.');
			return;
		}

		// Check if Postgres container is running
		const containerName = 'typedai-postgres';
		const { stdout: psOutput } = await execAsync(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`);

		if (psOutput.trim() === containerName) {
			logger.debug('Postgres container already running');
			return;
		}

		// Check if container exists but is stopped
		const { stdout: psAllOutput } = await execAsync(`docker ps -a --filter "name=${containerName}" --format "{{.Names}}"`);

		if (psAllOutput.trim() === containerName) {
			logger.info('Starting existing Postgres container...');
			await execAsync('docker compose up -d postgres');
		} else {
			logger.info('Creating and starting Postgres container...');
			await execAsync('docker compose up -d postgres');
		}

		// Wait for Postgres to be healthy
		logger.info('Waiting for Postgres to be ready...');
		const maxAttempts = 30;
		let attempts = 0;

		while (attempts < maxAttempts) {
			try {
				const { stdout } = await execAsync(`docker exec ${containerName} pg_isready -U postgres`);
				if (stdout.includes('accepting connections')) {
					logger.info('✓ Postgres container is ready');
					return;
				}
			} catch {
				// Container might not be ready yet
			}

			attempts++;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		logger.error('Postgres container failed to become ready after 30 seconds');
		throw new Error('Timeout waiting for Postgres container to be ready');
	} catch (error: any) {
		logger.error(error, 'Failed to ensure Postgres Docker container is running');
		logger.error('');
		logger.error('Troubleshooting steps:');
		logger.error('1. Check if Docker is running: docker ps');
		logger.error('2. Try manually starting: docker compose up postgres');
		logger.error('3. Check logs: docker compose logs postgres');
		logger.error('4. See docs/POSTGRES_SETUP.md for full setup guide');
		throw error;
	}
}
