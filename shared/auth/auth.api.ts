import { Type } from '@sinclair/typebox';
import { defineApiRoute } from '#shared/api-definitions';
import { UserProfileSchema } from '#shared/user/user.schema';

const AUTH_BASE = '/api/auth';

const AuthResponseSchema = Type.Object({
	user: UserProfileSchema,
	accessToken: Type.String(),
});

export const AUTH_API = {
	signIn: defineApiRoute('POST', `${AUTH_BASE}/signin`, {
		schema: {
			body: Type.Object({
				email: Type.String(),
				password: Type.String(),
			}),
			response: {
				200: AuthResponseSchema,
			},
		},
	}),
	signUp: defineApiRoute('POST', `${AUTH_BASE}/signup`, {
		schema: {
			body: Type.Object({
				email: Type.String(),
				password: Type.String(),
			}),
			response: {
				200: AuthResponseSchema,
			},
		},
	}),
};
