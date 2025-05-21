import { Type } from '@sinclair/typebox';
import { defineRoute } from '#shared/api-definitions';

import { ApiNullResponseSchema } from '#shared/schemas/common.schema';
import { UserProfileSchema, UserProfileUpdateSchema } from '../schemas/user.schema';

const PROFILE_BASE = '/api/profile';
const USERS_PROFILE_BASE = '/users/profile'; // Consistent with new requirements

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
	updateProfile: defineRoute('PUT', `${USERS_PROFILE_BASE}`, {
		schema: {
			body: Type.Object({ name: Type.String() }),
			response: {
				200: UserProfileSchema, // Assuming the updated profile is returned
				204: ApiNullResponseSchema,
			},
		},
	}),
	/** For the user to change their password */
	changePassword: defineRoute('POST', `${USERS_PROFILE_BASE}/change-password`, {
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
