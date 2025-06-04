import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { join } from 'node:path';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import fastify, {
	type ContextConfigDefault,
	type FastifyBaseLogger,
	type FastifyInstance,
	type FastifyReply as FastifyReplyBase,
	type FastifyRequest as FastifyRequestBase,
	type FastifySchema,
	type FastifyTypeProvider,
	type FastifyTypeProviderDefault,
	type RawReplyDefaultExpression,
	type RawRequestDefaultExpression,
	type RawServerDefault,
	type RouteGenericInterface,
} from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { FastifyReplyType, ResolveFastifyReplyType } from 'fastify/types/type-provider';
import type { RawServerBase } from 'fastify/types/utils';
import { StatusCodes } from 'http-status-codes';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { googleIapMiddleware, jwtAuthMiddleware, singleUserMiddleware } from '#fastify/authenticationMiddleware';
import { sendBadRequest } from '#fastify/responses'; // mapReplacer might not be needed by sendJSON anymore
import { logger } from '#o11y/logger';
import { loadOnRequestHooks } from './hooks';

const NODE_ENV = process.env.NODE_ENV ?? 'development';

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

export type FastifyRoutes = (fastify: AppFastifyInstance) => Promise<void>;

/** Our Fastify request type used in the application */
export interface FastifyRequest extends FastifyRequestBase {}

// Augment FastifyReply for the new decorator
declare module 'fastify' {
	interface FastifyReply<
		RawServer extends RawServerBase = RawServerDefault,
		RawRequest extends RawRequestDefaultExpression<RawServer> = RawRequestDefaultExpression<RawServer>,
		RawReply extends RawReplyDefaultExpression<RawServer> = RawReplyDefaultExpression<RawServer>,
		RouteGeneric extends RouteGenericInterface = RouteGenericInterface,
		ContextConfig = ContextConfigDefault,
		SchemaCompiler extends FastifySchema = FastifySchema,
		TypeProvider extends FastifyTypeProvider = FastifyTypeProviderDefault,
		ReplyType extends FastifyReplyType = ResolveFastifyReplyType<TypeProvider, SchemaCompiler, RouteGeneric>,
	> {
		/**
		 * @param object The object to send as JSON. This will be statically typed-checked at compile time and validated at runtime against the route schema
		 * @param status Optional HTTP status code. This should not be be provided if the route schema has a 2xx status response type schema, as it will automatically infer the status code.
		 */
		sendJSON(
			this: FastifyReply<RawServer, RawRequest, RawReply, RouteGeneric, ContextConfig, SchemaCompiler, TypeProvider, ReplyType>,
			object: ReplyType,
			status?: number,
		): FastifyReply<RawServer, RawRequest, RawReply, RouteGeneric, ContextConfig, SchemaCompiler, TypeProvider, ReplyType>;
	}
}
export const fastifyInstance: TypeBoxFastifyInstance = fastify({
	maxParamLength: 256,
	bodyLimit: 20048576,
}).withTypeProvider<TypeBoxTypeProvider>() as AppFastifyInstance;

export interface FastifyConfig {
	/** The port to listen on. If not provided looks up from process.env.PORT or else process.env.SERVER_PORT */
	port?: number;
	routes: FastifyRoutes[];
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
	// https://www.npmjs.com/package/fastify-http-errors-enhanced Needs to be imported this way because of commonjs/module issues.
	const { plugin } = await import('fastify-http-errors-enhanced');
	await fastifyInstance.register(plugin, {
		convertResponsesValidationErrors: true,
	});

	await loadPlugins(config);
	loadHooks();
	if (config.instanceDecorators) registerInstanceDecorators(config.instanceDecorators);
	if (config.requestDecorators) registerRequestDecorators(config.requestDecorators);

	// Decorate reply with sendJSON
	// The implementation's `object` parameter is `any` because type checking for the caller is handled by the augmented interface.
	fastifyInstance.decorateReply('sendJSON', function (this: FastifyReplyBase, object: any, explicitStatus?: number) {
		this.header('Content-Type', 'application/json; charset=utf-8');

		let derivedSchemaStatus: number | undefined = undefined; // Initialize derived status
		// No explicit status passed to sendJSON. Try to derive from schema.
		// this.request is available on the reply object in a handler context
		const routeSchema = this.request?.routeOptions?.schema;
		if (routeSchema?.response) {
			const responseSchemaMap = routeSchema.response as Record<string, any>;
			const available2xxStatusCodes: number[] = [];
			for (const statusCodeStr in responseSchemaMap) {
				if (Object.prototype.hasOwnProperty.call(responseSchemaMap, statusCodeStr)) {
					const statusCode = Number.parseInt(statusCodeStr, 10);
					if (!Number.isNaN(statusCode) && statusCode >= 200 && statusCode < 300) {
						available2xxStatusCodes.push(statusCode);
					}
				}
			}

			if (available2xxStatusCodes.length > 0) {
				// Sort for predictable selection (e.g., if multiple 'otherSpecific' codes exist)
				available2xxStatusCodes.sort((a, b) => a - b);

				const has200 = available2xxStatusCodes.includes(StatusCodes.OK);
				const has201 = available2xxStatusCodes.includes(StatusCodes.CREATED);
				const has204 = available2xxStatusCodes.includes(StatusCodes.NO_CONTENT);
				const otherSpecific2xx = available2xxStatusCodes.filter((sc) => sc !== StatusCodes.OK && sc !== StatusCodes.CREATED && sc !== StatusCodes.NO_CONTENT); // Already sorted due to prior sort

				// Priority 1: 204 for null payload if schema for 204 exists
				if (object === null && has204) {
					derivedSchemaStatus = StatusCodes.NO_CONTENT;
				}
				// Priority 2: 201 if schema for 201 exists (and payload is not null)
				else if (object !== null && has201) {
					derivedSchemaStatus = StatusCodes.CREATED;
				}
				// Priority 3: Other specific non-200/non-204/non-201 2xx codes (e.g., 202)
				else if (object !== null && otherSpecific2xx.length > 0) {
					derivedSchemaStatus = otherSpecific2xx[0]; // Smallest of these due to sort
				}
				// Priority 4: 200 if schema for 200 exists
				else if (has200) {
					derivedSchemaStatus = StatusCodes.OK;
				}
				// Priority 5: Fallback for less common cases
				else if (available2xxStatusCodes.length > 0) {
					// E.g., only 204 schema exists, but object is not null (don't use 204).
					// Or only 201 schema, but object is null (don't use 201).
					// Or only a 205 schema exists.
					if (has204 && object !== null) {
						// We have a 204 schema, but are sending content. Avoid 204.
						// If other schemas like 200 are also present, they would have been picked earlier.
						// This implies 204 might be the *only* or smallest option left.
						const suitableAlternatives = available2xxStatusCodes.filter((sc) => sc !== StatusCodes.NO_CONTENT);
						if (suitableAlternatives.length > 0) derivedSchemaStatus = suitableAlternatives[0];
						else derivedSchemaStatus = undefined; // No suitable schema status
					} else {
						// Default to smallest available if no specific rule above matched perfectly
						// (e.g. only a 205 schema, or 201 with null object and no 204 schema)
						derivedSchemaStatus = available2xxStatusCodes[0];
					}
				}
			}
		}

		// Determine the final status code to use
		// Priority: Explicit status > Derived schema status > reply.code() > Default 200
		let finalStatus = this.statusCode; // Get status potentially set by reply.code()

		if (explicitStatus !== undefined) {
			// Explicit status from sendJSON call takes highest priority
			finalStatus = explicitStatus;
			// Log a warning if explicit status conflicts with a derived schema status, but only if both are 2xx
			if (
				derivedSchemaStatus !== undefined &&
				explicitStatus !== derivedSchemaStatus &&
				explicitStatus >= 200 &&
				explicitStatus < 300 &&
				derivedSchemaStatus >= 200 &&
				derivedSchemaStatus < 300
			) {
				logger.warn(`Explicit status ${explicitStatus} overrides derived schema status ${derivedSchemaStatus}`);
			}
		} else if (derivedSchemaStatus !== undefined) {
			// If no explicit status, use the derived schema status if available
			finalStatus = derivedSchemaStatus;
		}
		// If neither explicit nor derived, finalStatus remains whatever was set by reply.code() (defaults to 200 if not set)

		// Set the determined final status code
		this.status(finalStatus);

		// Fastify will validate against the schema for the given status and then serialize.
		this.send(object);

		if (this.statusCode === 500) {
			console.log('500 response');
			console.log(this.failedValidations);
			console.log(object);
		}

		return this;
	});

	registerRoutes(config.routes); // New application routes must be added the config in server.ts

	// All backend API routes start with /api/ so any unmatched at this point is a 404
	fastifyInstance.get('/api/*', async (request, reply) => {
		return reply.code(StatusCodes.NOT_FOUND).send({ error: 'Not Found' });
	});

	// When the user has refreshed the page at an Angular route URL, serve the index.html
	fastifyInstance.get('/ui/*', async (request, reply) => {
		// TODO serve this compressed when possible
		return reply.header('Content-Type', 'text/html').header('Cache-Control', 'no-store, no-cache, must-revalidate').code(StatusCodes.OK).send(indexHtml);
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
				port = Number.parseInt(process.env[envVar] ?? '');
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
	await fastifyInstance.register(import('@fastify/jwt'), {
		secret: process.env.JWT_SECRET || 'your-secret-key',
	});
	await fastifyInstance.register(import('@fastify/cors'), {
		origin: ['*'], // new URL(process.env.UI_URL).origin
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

function registerRoutes(routes: FastifyRoutes[]) {
	for (const route of routes) {
		fastifyInstance.register(route as any);
	}
}

function setErrorHandler() {
	fastifyInstance.setErrorHandler((error: any, req: FastifyRequest, reply: FastifyReplyBase) => {
		logger.error({
			message: `Error handler: ${error.message}`,
			error,
			request: req.query,
		});
		// reply.header('Content-Type', 'application/json; charset=utf-8'); // sendBadRequest will set this

		if (error.validation) {
			sendBadRequest(reply, error.message);
			return;
		}

		if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
			sendBadRequest(reply, 'Invalid media type');
			return;
		}
		logger.error(error);
		sendBadRequest(reply, NODE_ENV === 'production' ? 'An internal server error occurred. Please try again later.' : error.message);
	});
}
