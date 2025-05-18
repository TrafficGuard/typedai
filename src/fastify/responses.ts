import type { FastifyReply } from 'fastify';
import * as HttpStatus from 'http-status-codes';

export function send(reply: FastifyReply, statusCode: number, data: Record<string, any> | string | null = null, extra: object | null = {}): void {
	reply.header('Content-Type', 'application/json; charset=utf-8');
	reply.status(statusCode);

	const payload: any = Object.assign({ statusCode: statusCode }, extra);
	if (data) {
		payload.data = data;
	}

	reply.send(payload);
}

// Fix JSON.toString(map) only ever outputting {}
function mapReplacer(_key: string, value: any) {
	return value instanceof Map ? Object.fromEntries(value) : value;
}

/**
 * @deprecated User response.sendJSON
 * @param reply
 * @param object
 */
export function sendJSON(reply: FastifyReply, object: any): void {
	reply.header('Content-Type', 'application/json; charset=utf-8');
	// Note: status(200) was here, but individual handlers should set their status (e.g., 200, 201)
	// For 200, it's often the default, but explicit is fine.
	// If reply.code() is called before this, it will take precedence.
	// If no code is set, Fastify defaults to 200 for .send().
	reply.send(JSON.stringify(object, mapReplacer));
}

export function sendHTML(reply: FastifyReply, html: string): void {
	reply.header('Content-Type', 'text/html; charset=utf-8');
	reply.status(200); // Typically HTML responses are 200 OK
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
