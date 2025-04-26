import type { AppFastifyInstance } from '#applicationTypes';
import type { FastifyRequest } from '#fastify/fastifyApp'; // Import the correct request type
import { FirestoreVibeService } from '#modules/firestore/firestoreVibeService'; // Adjust path if needed
import { Static, Type } from '@sinclair/typebox';
// import { VibeSession } from '#modules/firestore/firestoreVibeService'; // Import the backend type - Not strictly needed if using schema below

// Define a TypeBox schema for the response (subset of VibeSession)
// Note: Firestore returns Timestamps, which might need conversion or specific handling
// For simplicity, let's assume they are handled/serializable or define a simpler schema for the API response.
const VibeSessionListResponseSchema = Type.Array(
	Type.Object({
		id: Type.String(),
		title: Type.String(),
		status: Type.String(), // Consider using Type.Union if statuses are fixed
		createdAt: Type.Any(), // Use Type.Any() or a more specific schema if serialization is handled (e.g., Type.String() for ISO string)
		// Add other fields if needed by the frontend list view
	}),
);

// Define a schema for error responses
const ErrorResponseSchema = Type.Object({
	error: Type.String(),
});

export async function vibeRoutes(fastify: AppFastifyInstance) {
	const firestoreVibeService = new FirestoreVibeService(); // Or retrieve via dependency injection if set up

	fastify.get(
		'/sessions',
		{
			schema: {
				// Add response schema for validation and documentation
				response: {
					200: VibeSessionListResponseSchema,
					401: ErrorResponseSchema, // Add schema for 401
				},
			},
		},
		// Explicitly type the request parameter
		async (request: FastifyRequest, reply) => {
			// Assuming authentication middleware adds `currentUser` to the request
			if (!request.currentUser?.id) {
				return reply.code(401).send({ error: 'Unauthorized' });
			const sessions = await firestoreVibeService.listVibeSessions(userId);

			// Optional: Map sessions to the response schema if needed (e.g., timestamp conversion)
			// const responseSessions = sessions.map(session => ({
			//     id: session.id,
			//     title: session.title,
			//     status: session.status,
			//     createdAt: session.createdAt.toDate().toISOString(), // Example conversion
			// }));

			return reply.send(sessions); // Send the raw sessions or the mapped responseSessions
		},
	);

	// Add other vibe routes here if needed in the future (e.g., GET /sessions/:id, POST /sessions, etc.)
}
