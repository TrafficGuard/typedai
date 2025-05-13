import {defineRoute} from "#shared/api-definitions";

import {
    UserProfileSchema,
    UserProfileUpdateSchema,
} from '../schemas/user.schema';
import {ApiNullResponseSchema} from "#shared/schemas/common.schema";

const PROFILE_BASE = '/api/profile';
export const USER_API = {
        view: defineRoute('GET', `${PROFILE_BASE}/view`, {
            schema: {
                response: {
                    200: UserProfileSchema,
                }
            }
        }),
        /** For the user to update their own profile */
        update: defineRoute('POST', `${PROFILE_BASE}/update`, {
            schema: {
                body: UserProfileUpdateSchema,
                response: {
                    204: ApiNullResponseSchema,
                }
            }
        }),
};
