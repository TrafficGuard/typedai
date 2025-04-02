import { readFileSync } from 'fs';
import * as http from 'node:http';
import { join } from 'node:path';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import fastify, {
	FastifyBaseLogger,
	FastifyInstance,
	FastifyReply,
	FastifyRequest as FastifyRequestBase,
	RawReplyDefaultExpression,
	RawRequestDefaultExpression,
} from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import * as HttpStatus from 'http-status-codes';
import { googleIapMiddleware, jwtAuthMiddleware, singleUserMiddleware } from '#fastify/authenticationMiddleware';
import { logger } from '#o11y/logger';
import { User } from '#user/user';
import { AppFastifyInstance } from '../applicationTypes';
import { loadOnRequestHooks } from './hooks';

const NODE_ENV = process.env.NODE_ENV ?? 'local';

export const DEFAULT_HEALTHCHECK = '/health-check';

const STATIC_PATH = process.env.STATIC_PATH || 'frontend/dist/fuse/browser';

let indexHtml: string;

export type TypeBoxFastifyInstance = FastifyInstance<
	http.Server,
	RawRequestDefaultExpression<http.Server>,
	RawReplyDefaultExpression<http.Server>,
	FastifyBaseLogger,
	TypeBoxTypeProvider
>;

export type RouteDefinition = (fastify: AppFastifyInstance) => Promise<void>;

/** Our Fastify request type used in the application */
interface FastifyRequest extends FastifyRequestBase {
	currentUser?: User;
}

export const fastifyInstance: TypeBoxFastifyInstance = fastify({
	maxParamLength: 256,
}).withTypeProvider<TypeBoxTypeProvider>() as AppFastifyInstance;

export interface FastifyConfig {
	/** The port to listen on. If not provided looks up from process.env.PORT or else process.env.SERVER_PORT */
	port?: number;
	routes: RouteDefinition[];
	instanceDecorators?: { [key: string]: any };
	requestDecorators?: { [key: string]: any };
	/** Overrides the default url of /health-check. IAP middleware is currently dependent on DEFAULT_HEALTHCHECK */
	// healthcheckUrl?: string;
}

export async function initFastify(config: FastifyConfig): Promise<AppFastifyInstance> {
	const indexHtmlPath = join(STATIC_PATH, 'index.html');
	try {
		indexHtml = readFileSync(indexHtmlPath).toString();
	} catch (e) {
		logger.info(`${indexHtmlPath} not found`);
	}
	/*
   	 To guarantee a consistent and predictable behaviour of your application, we highly recommend to always load your code as shown below:
      └── plugins (from the Fastify ecosystem)
      └── your plugins (your custom plugins)
      └── decorators
      └── hooks and middlewares
      └── your services
 	*/
	await loadPlugins(config);
	loadHooks();
	if (config.instanceDecorators) registerInstanceDecorators(config.instanceDecorators);
	if (config.requestDecorators) registerRequestDecorators(config.requestDecorators);
	registerRoutes(config.routes);

	// All backend API routes start with /api/ so any unmatched at this point is a 404
	fastifyInstance.get('/api/*', async (request, reply) => {
		return reply.code(404).send({ error: 'Not Found' });
	});
	fastifyInstance.post('/api/*', async (request, reply) => {
		return reply.code(404).send({ error: 'Not Found' });
	});

	// When the user has refreshed the page at an Angular route URL, serve the index.html
	fastifyInstance.get('/ui/*', async (request, reply) => {
		// TODO serve this compressed when possible
		return reply.header('Content-Type', 'text/html').header('Cache-Control', 'no-store, no-cache, must-revalidate').code(200).send(indexHtml);
	});

	// TODO precompress https://github.com/fastify/fastify-static?tab=readme-ov-file#precompressed
	fastifyInstance.register(require('@fastify/static'), {
		root: join(process.cwd(), STATIC_PATH),
		prefix: '/',
	});

	setErrorHandler();

	let port = config.port;
	// If not provided autodetect from PORT or SERVER_PORT
	// https://cloud.google.com/run/docs/container-contract#port
	if (!port) {
		const envVars = ['PORT', 'SERVER_PORT'];
		for (const envVar of envVars) {
			try {
				port = parseInt(process.env[envVar] ?? '');
				break;
			} catch (e) {}
		}
		if (!port) throw new Error('Could not autodetect the server port to use from either the PORT or SERVER_PORT environment variables');
	}
	listen(port);
	return fastifyInstance as AppFastifyInstance;
}

function listen(port: number): void {
	fastifyInstance.listen(
		{
			host: '0.0.0.0',
			port,
		},
		(err: any) => {
			if (err) {
				throw err;
			}
			logger.info(`Listening on ${port}`);
		},
	);
}

async function loadPlugins(config: FastifyConfig) {
	// Register JWT plugin
	await fastifyInstance.register(import('@fastify/jwt'), {
		secret: process.env.JWT_SECRET || 'your-secret-key',
	});
	await fastifyInstance.register(import('@fastify/cors'), {
		origin: ['*'], // new URL(process.env.UI_URL).origin
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allow these HTTP methods
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Goog-Iap-Jwt-Assertion', 'Enctype'], // Allow these headers
		credentials: true,
	});
	await fastifyInstance.register(require('@fastify/multipart'));
	await fastifyInstance.register(require('fastify-healthcheck'), {
		healthcheckUrl: /* config.healthcheckUrl ?? */ DEFAULT_HEALTHCHECK,
	});
	await fastifyInstance.register(import('fastify-raw-body'), {
		field: 'rawBody',
		global: false,
		encoding: 'utf8',
		runFirst: true,
		routes: [],
	});
}

function loadHooks() {
	loadOnRequestHooks(fastifyInstance);

	// Authentication hook
	let authenticationMiddleware = null;
	if (process.env.AUTH === 'google_iap') {
		authenticationMiddleware = googleIapMiddleware;
		logger.info('Configured Google IAP authentication middleware');
	} else if (process.env.AUTH === 'single_user') {
		authenticationMiddleware = singleUserMiddleware;
		logger.info('Configured Single User authentication middleware');
	} else if (process.env.AUTH === 'password') {
		authenticationMiddleware = jwtAuthMiddleware;
		logger.info('Configured JWT authentication middleware');
	} else {
		throw new Error('No valid authentication configured. Set AUTH to single_user, google_iap or password');
	}
	fastifyInstance.addHook('onRequest', authenticationMiddleware);
}

function registerInstanceDecorators(decorators: { [key: string]: any }) {
	fastifyInstance.register(
		fastifyPlugin(async (instance: FastifyInstance) => {
			for (const [key, value] of Object.entries(decorators)) {
				instance.decorate(key, value);
			}
		}),
	);
}

function registerRequestDecorators(decorators: { [key: string]: any }) {
	fastifyInstance.register(
		fastifyPlugin(async (instance: FastifyInstance) => {
			for (const [key, value] of Object.entries(decorators)) {
				instance.decorateReply(key, value);
			}
		}),
	);
}

function registerRoutes(routes: RouteDefinition[]) {
	for (const route of routes) {
		fastifyInstance.register(route as any);
	}
}

function setErrorHandler() {
	fastifyInstance.setErrorHandler((error: any, req: FastifyRequest, reply: FastifyReply) => {
		logger.error({
			message: `Error handler: ${error.message}`,
			error,
			request: req.query,
		});
		reply.header('Content-Type', 'application/json; charset=utf-8');

		if (error.validation) {
			reply.status(HttpStatus.BAD_REQUEST).send({
				statusCode: HttpStatus.BAD_REQUEST,
				message: error.message,
			});
			return;
		}

		if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
			reply.status(HttpStatus.BAD_REQUEST).send({
				statusCode: HttpStatus.BAD_REQUEST,
				message: 'Invalid media type',
			});
			return;
		}

		// TODO reportError(error);
		logger.error(error);

		reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
			statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
			message: NODE_ENV === 'production' ? 'An internal server error occurred. Please try again later.' : error.message,
		});
	});
}
