import * as bcrypt from 'bcrypt';
import type { User } from '#user/user';
import type { UserService } from '#user/userService/userService';

export const SINGLE_USER_ID = 'user';

const singleUser: User = {
	enabled: false,
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

export class InMemoryUserService implements UserService {
	private passwordHashes: Map<string, string> = new Map();

	async authenticateUser(email: string, password: string): Promise<User> {
		const user = await this.getUserByEmail(email);
		const hash = this.passwordHashes.get(user.id);
		if (!hash) {
			throw new Error('Invalid credentials');
		}

		const isValid = await bcrypt.compare(password, hash);
		if (!isValid) {
			throw new Error('Invalid credentials');
		}

		await this.updateUser({ lastLoginAt: new Date() }, user.id);
		return user;
	}

	async createUserWithPassword(email: string, password: string): Promise<User> {
		const existingUser = await this.getUserByEmail(email).catch(() => null);
		if (existingUser) {
			throw new Error('User already exists');
		}

		const passwordHash = await bcrypt.hash(password, 10);
		const user = await this.createUser({
			email,
			enabled: true,
			createdAt: new Date(),
			hilCount: 5,
			hilBudget: 1,
			functionConfig: {},
			llmConfig: {},
		});

		this.passwordHashes.set(user.id, passwordHash);
		return user;
	}

	async updatePassword(userId: string, newPassword: string): Promise<void> {
		const passwordHash = await bcrypt.hash(newPassword, 10);
		this.passwordHashes.set(userId, passwordHash);
	}
	users: User[] = [singleUser];

	async getUser(userId: string): Promise<User> {
		const user = this.users.find((user) => user.id === userId);
		if (!user) throw new Error(`No user found with ID ${userId}`);
		return user;
	}

	async getUserByEmail(email: string): Promise<User> {
		const user = this.users.find((user) => user.email === email);
		if (!user) throw new Error(`No user found with email ${email}`);
		return user;
	}

	async updateUser(updates: Partial<User>, userId?: string): Promise<User> {
		userId ??= SINGLE_USER_ID;
		const user = await this.getUser(userId);
		Object.assign(user, updates);
		return user;
	}

	async disableUser(userId: string): Promise<void> {
		const user = await this.getUser(userId);
		user.enabled = false;
	}

	async listUsers(): Promise<User[]> {
		return this.users;
	}

	createUser(user: Partial<User>): Promise<User> {
		const newUser: User = {
			id: user.id,
			email: user.email,
			enabled: user.enabled ?? true,
			hilBudget: user.hilBudget ?? 0,
			hilCount: user.hilCount ?? 0,
			llmConfig: user.llmConfig ?? { anthropicKey: '', openaiKey: '', groqKey: '', togetheraiKey: '' },
			chat: {
				enabledLLMs: {},
				defaultLLM: '',
				temperature: 1,
			},
			functionConfig: {},
			createdAt: user.createdAt ?? new Date(),
		};
		this.users.push(newUser);
		return Promise.resolve(newUser);
	}

	async ensureSingleUser(): Promise<void> {}

	getSingleUser(): User {
		return singleUser;
	}
}
