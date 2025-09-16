import { agentContext } from '#agent/agentContextLocalStorage';
import { inMemoryApplicationContext } from '#modules/memory/inMemoryApplicationContext';
import { logger, setLogEnricher } from '#o11y/logger';
import type { ApplicationContext } from './applicationTypes';

export let applicationContext: ApplicationContext;

let initialInit: Error | undefined;

export async function initApplicationContext(): Promise<ApplicationContext> {
	if (applicationContext) {
		logger.warn('Application context already initialized at');
		logger.warn(initialInit);
		logger.warn('Application context attempted to be re-initialized at');
		logger.warn(new Error());
		return applicationContext;
	}
	initialInit = new Error();

	// Security check to prevent single-user mode in production environments
	logger.info(`AUTH: ${process.env.AUTH}`);
	logger.info(`NODE_ENV: ${process.env.NODE_ENV}`);
	logger.info(`DATABASE_TYPE: ${process.env.DATABASE_TYPE}`);
	logger.info(`DATABASE_NAME: ${process.env.DATABASE_NAME}`);
	logger.info(`GCLOUD_PROJECT: ${process.env.GCLOUD_PROJECT}`);

	const authMode = process.env.AUTH;
	const nodeEnv = process.env.NODE_ENV;
	const isConfiguredForSingleUser = !authMode || authMode === 'single_user';

	if (isConfiguredForSingleUser && nodeEnv === 'production') {
		const errorMessage =
			'CRITICAL SECURITY CONFIGURATION ERROR: Application is configured for single-user mode ' +
			'(AUTH=single_user or AUTH is not set) in a PRODUCTION environment (NODE_ENV=production). ' +
			'This mode is intended for local development ONLY and is insecure for production. ' +
			'The application will not start. Please configure a secure authentication method for production.';
		logger.fatal(errorMessage);
		throw new Error('Single-user mode is not permitted in production environments. Halting application startup.');
	}

	const database = process.env.DATABASE_TYPE;
	if (database === 'memory') {
		initInMemoryApplicationContext();
	} else if (database === 'firestore') {
		await initFirestoreApplicationContext();
	} else if (database === 'postgres') {
		await initPostgresApplicationContext();
	} else {
		throw new Error(`Invalid value for DATABASE_TYPE environment: ${database}`);
	}

	setLogEnricher((logObj: any) => {
		const agent = agentContext();
		if (agent) {
			logObj.agentId = agent.agentId;
			if (agent.parentAgentId) logObj.parentAgentId = agent.parentAgentId;
		}
	});

	return applicationContext;
}

/**
 * @return the main application context
 */
export function appContext(): ApplicationContext {
	// Default to in-memory so unit tests don't need to initialise every time
	applicationContext ??= initInMemoryApplicationContext();
	return applicationContext;
}

export async function initFirestoreApplicationContext(): Promise<ApplicationContext> {
	if (applicationContext) throw new Error('Application context already initialized');
	logger.info('Initializing Firestore persistence');
	// async import to minimize loading dependencies on startup
	const firestoreModule = await import('../modules/firestore/firestoreModule.cjs');
	applicationContext = firestoreModule.firestoreApplicationContext();
	await applicationContext.userService.ensureSingleUser();
	return applicationContext;
}

export async function initPostgresApplicationContext(): Promise<ApplicationContext> {
	if (applicationContext) throw new Error('Application context already initialized');
	logger.info('Initializing Postgres persistence');
	// async import to minimize loading dependencies on startup
	const postgresModule = await import('../modules/postgres/postgresModule.cjs');
	applicationContext = postgresModule.postgresApplicationContext();
	await applicationContext?.init?.();
	await applicationContext.userService.ensureSingleUser();
	return applicationContext;
}

export function initInMemoryApplicationContext(): ApplicationContext {
	// if (applicationContext) throw new Error('Application context already initialized');
	applicationContext = inMemoryApplicationContext();
	applicationContext.userService.ensureSingleUser().catch();
	return applicationContext;
}
