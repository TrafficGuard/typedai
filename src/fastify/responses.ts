import type { FastifyReply } from 'fastify';
import * as HttpStatus from 'http-status-codes';

export function send(reply: any, statusCode: number, data: Record<string, any> | string | null = null, extra: object | null = {}): void {
	reply.header('Content-Type', 'application/json; charset=utf-8');
	reply.status(statusCode);

	const payload: any = Object.assign({ statusCode: statusCode }, extra);
	if (data) {
		payload.data = data;
	}

	reply.send(payload);
}

export function sendJSON(reply: any, object: any): void {
	reply.header('Content-Type', 'application/json; charset=utf-8');
	reply.status(200);
	reply.send(JSON.stringify(object));
}

export function sendHTML(reply: any, html: string): void {
	reply.header('Content-Type', 'text/html; charset=utf-8');
	reply.status(200);
	reply.send(html);
}

/**
 * Sends a 200 response returning a JSON object with a message property
 * @param reply
 * @param message the value of the message property, defaulting to "success"
 */
export function sendSuccess(reply: FastifyReply, message = 'success'): void {
	send(reply, HttpStatus.OK, '', { message: message });
}

// --- Modified Error Handlers ---

export function sendBadRequest(reply: FastifyReply, message = 'Bad Request'): void {
	// Directly send payload matching ErrorResponseSchema { error: string }
	reply.status(HttpStatus.BAD_REQUEST);
	reply.send({ error: message });
}

export function sendUnauthorized(reply: FastifyReply): void {
	// Directly send payload matching ErrorResponseSchema { error: string }
	reply.status(HttpStatus.UNAUTHORIZED);
	reply.send({ error: 'Unauthorized' });
}

export function sendNotFound(reply: FastifyReply, message = 'Not Found'): void {
	// Directly send payload matching ErrorResponseSchema { error: string }
	reply.status(HttpStatus.NOT_FOUND);
	reply.send({ error: message });
}

export function sendServerError(reply: FastifyReply, message = 'Server error'): void {
	// Directly send payload matching ErrorResponseSchema { error: string }
	reply.status(HttpStatus.INTERNAL_SERVER_ERROR);
	reply.send({ error: message });
}
