import { Type } from '@sinclair/typebox';
import { defineRoute } from '#shared/api-definitions';
import { ApiNullResponseSchema } from '#shared/common.schema';
import { UserProfileSchema, UserProfileUpdateSchema } from './user.schema';

const PROFILE_BASE = '/api/profile';

export const USER_API = {
	view: defineRoute('GET', `${PROFILE_BASE}/view`, {
		schema: {
			response: {
				200: UserProfileSchema,
			},
		},
	}),
	/** For the user to update their own profile (broader updates) */
	update: defineRoute('POST', `${PROFILE_BASE}/update`, {
		schema: {
			body: UserProfileUpdateSchema,
			response: {
				204: ApiNullResponseSchema,
			},
		},
	}),
	/** For the user to update their display name */
	updateProfile: defineRoute('PUT', `${PROFILE_BASE}`, {
		schema: {
			body: Type.Object({ name: Type.String() }),
			response: {
				200: UserProfileSchema,
				204: ApiNullResponseSchema,
			},
		},
	}),
	/** For the user to change their password */
	changePassword: defineRoute('POST', `${PROFILE_BASE}/change-password`, {
		schema: {
			body: Type.Object({
				currentPassword: Type.String(),
				newPassword: Type.String(),
			}),
			response: {
				204: ApiNullResponseSchema,
			},
		},
	}),
};
