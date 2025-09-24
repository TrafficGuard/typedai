import { initApplicationContext } from '#app/applicationContext';
import { logger } from '#o11y/logger';
import { getAllRoutes } from '#routes/routeRegistry';
import { GcpSecretManager } from './config/gcpSecretManager';
import { loadSecrets } from './config/secretConfig';
import { initFastify } from './fastify';

/**
 * Creates the applications services and starts the Fastify server.
 */
export async function initServer(): Promise<void> {
	await loadSecrets(new GcpSecretManager());
	const applicationContext = await initApplicationContext();

	// Ensures all the functions are registered
	// Load dynamically so the modules only load now
	const functionRegistry = (await import('./functionRegistryModule.cjs')).functionRegistry as () => Array<new () => any>;
	functionRegistry();

	try {
		await initFastify({
			routes: getAllRoutes(),
			instanceDecorators: applicationContext, // This makes all properties on the ApplicationContext interface available on the fastify instance in the routes
			requestDecorators: {},
		});
	} catch (err: any) {
		logger.fatal(err, 'Could not start TypedAI');
	}
}
