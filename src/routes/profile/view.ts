import type { AppFastifyInstance } from '#app/applicationTypes';
import { registerApiRoute } from '#routes/routeUtils';
import { USER_API } from '#shared/user/user.api';
import type { User, UserProfile } from '#shared/user/user.model';
import { currentUser } from '#user/userContext';

export async function viewProfileRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, USER_API.view, async (req, reply) => {
		const user: User = currentUser();

		const userProfileData: UserProfile = {
			id: user.id,
			name: user.name ?? '',
			email: user.email,
			enabled: user.enabled,
			hilBudget: user.hilBudget,
			hilCount: user.hilCount,
			llmConfig: user.llmConfig,
			chat: user.chat,
			functionConfig: user.functionConfig,
		};

		reply.sendJSON(userProfileData);
	});
}
