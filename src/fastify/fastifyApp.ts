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
// src/fastify/fastifyApp.ts:14:39 - error TS1479: The current file is a CommonJS module whose imports will produce 'require' calls; however, the referenced file is an ECMAScript module and cannot be imported with 'require'. Consider writing a dynamic 'import("fastify-http-errors-enhanced")' call instead.
//   To convert this file to an ECMAScript module, change its file extension to '.mts' or create a local package.json file with `{ "type": "module" }`.
// import fastifyHttpErrorsEnhanced from 'fastify-http-errors-enhanced'
import type { AppFastifyInstance } from '#app/applicationTypes';
import { googleIapMiddleware, jwtAuthMiddleware, singleUserMiddleware } from '#fastify/authenticationMiddleware';
import { sendBadRequest } from '#fastify/responses'; // mapReplacer might not be needed by sendJSON anymore
import { logger } from '#o11y/logger';
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
		sendJSON(
			this: FastifyReply<RawServer, RawRequest, RawReply, RouteGeneric, ContextConfig, SchemaCompiler, TypeProvider, ReplyType>,
			object: ReplyType, // Refers to the 8th generic of FastifyReply
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
	// https://www.npmjs.com/package/fastify-http-errors-enhanced
	const { plugin } = await import('fastify-http-errors-enhanced');
	await fastifyInstance.register(plugin, {
		convertResponsesValidationErrors: true,
		preHandler: (e) => {
			logger.warn('fastify-http-errors-enhanced prehandler');
			return e;
		},
	});

	await loadPlugins(config);
	loadHooks();
	if (config.instanceDecorators) registerInstanceDecorators(config.instanceDecorators);
	if (config.requestDecorators) registerRequestDecorators(config.requestDecorators);

	// Decorate reply with sendJSON
	// The implementation's `object` parameter is `any` because type checking for the caller is handled by the augmented interface.
	fastifyInstance.decorateReply('sendJSON', function (this: FastifyReplyBase, object: any, status: number = StatusCodes.OK) {
		this.header('Content-Type', 'application/json; charset=utf-8');
		this.status(status);
		// Fastify will validate against the schema for the given status and then serialize.
		try {
			// console.log(JSON.stringify(object));
			this.send(object);
		} catch (e) {
			// logger.error(`Error sending ${JSON.stringify(object)}`)
			// Access route information from the request object
			console.log(`== == == ${e.message}`);
			const serializeFn = this.getSerializationFunction(this.statusCode.toString());
			if (serializeFn) {
				console.log('== == == Serialization function:');
				console.log(serializeFn);
			} else {
				console.log(`== == == No serialization function found for ${status}`);
			}
			if (this.request) {
				console.error('== == == Route Path:', this.request.url); // or this.request.routerPath for the matched path
				console.error('== == == HTTP Method:', this.request.method);

				// Access the schema defined for the route
				const routeSchema = this.request.routeOptions?.schema; // For Fastify v3+
				// For older Fastify (v2.x), it might be this.request.context?.config?.schema

				if (routeSchema?.response) {
					// The response schema is typically an object mapping status codes to schema definitions
					const responseSchemaMap = routeSchema.response as Record<string, any>;
					const schemaForStatus = responseSchemaMap?.[status.toString()]; // e.g., responseSchemaMap['200']

					if (schemaForStatus) {
						console.error(`== == == Response schema for status ${status}:`, JSON.stringify(schemaForStatus, null, 2));
					} else {
						// If no specific schema for this status, log all available response schemas
						console.error(`== == == No specific response schema found for status ${status}.`);
						console.error('== == == Available response schemas on this route:', JSON.stringify(responseSchemaMap, null, 2));
					}
				} else {
					console.error('== == == No response schema (route.schema.response) found/defined for this route.');
				}
			} else {
				console.log('== == == No request on this');
			}
			console.log('== == == Object');
			console.log(JSON.stringify(object));
			throw e;
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
