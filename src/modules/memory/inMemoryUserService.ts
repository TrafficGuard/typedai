import type { User } from '#shared/user/user.model';
import { AbstractUserService } from '#user/abstractUserService';

export const SINGLE_USER_ID = 'user';

const singleUser: User = {
	enabled: false,
	admin: false,
	name: 'John Doe',
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	chat: {
		enabledLLMs: {},
		defaultLLM: '',
		temperature: 1,
	},
	id: SINGLE_USER_ID,
	email: 'user@domain.com',
	functionConfig: {},
	createdAt: new Date(),
};

export class InMemoryUserService extends AbstractUserService {
	users: User[] = [singleUser];

	constructor() {
		super();
		this.singleUser = singleUser;
	}

	async getUser(userId: string): Promise<User> {
		const user = this.users.find((user) => user.id === userId);
		if (!user) throw new Error(`No user found with ID ${userId}`);
		return user;
	}

	async getUserByEmail(email: string): Promise<User | null> {
		const user = this.users.find((user) => user.email === email);
		return user || null;
	}

	async updateUser(updates: Partial<User>, userId?: string): Promise<User> {
		userId ??= SINGLE_USER_ID;
		const user = await this.getUser(userId);
		Object.assign(user, updates);
		return user;
	}

	async listUsers(): Promise<User[]> {
		return this.users;
	}

	createUser(user: Partial<User>): Promise<User> {
		const randomSuffix = Math.random().toString(36).substring(2, 9);
		const newUser: User = {
			id: user.id || `mem-id-${randomSuffix}`,
			name: user.name ?? 'Test User',
			email: user.email!, // Assume email is always provided for new user creation
			enabled: user.enabled ?? true,
			hilBudget: user.hilBudget ?? 0,
			hilCount: user.hilCount ?? 0,
			createdAt: user.createdAt instanceof Date ? user.createdAt : new Date(),
			passwordHash: user.passwordHash,
			lastLoginAt: user.lastLoginAt instanceof Date ? user.lastLoginAt : undefined,
			llmConfig: user.llmConfig ?? {},
			chat: user.chat ?? {
				enabledLLMs: {},
				defaultLLM: '',
				temperature: 1,
				topP: 1,
				topK: 50,
				frequencyPenalty: 0,
				presencePenalty: 0,
			},
			functionConfig: user.functionConfig ?? {},
		};
		this.users.push(newUser);
		return Promise.resolve(newUser);
	}
}
