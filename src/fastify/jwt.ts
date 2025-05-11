import type { User } from '#shared/model/user.model';

export interface JWTPayload {
	userId: string;
	email: string;
}

// Helper to convert User to JWT payload
export function userToJwtPayload(user: User): JWTPayload {
	return {
		userId: user.id,
		email: user.email,
	};
}

// Helper to extract userId from JWT verify payload
export function getPayloadUserId(payload: any): string {
	if (typeof payload === 'string') {
		return payload; // Handle string payload case
	}
	return payload.userId;
}
