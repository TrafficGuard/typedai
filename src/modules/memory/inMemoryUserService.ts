import * as bcrypt from 'bcrypt';
import type { User } from '#shared/user/user.model';
import type { UserService } from '#user/userService';

export const SINGLE_USER_ID = 'user';

const singleUser: User = {
	enabled: false,
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
		const existingUser = await this.getUserByEmail(email);
		if (existingUser) {
			throw new Error('User already exists');
		}

		const passwordHash = await bcrypt.hash(password, 10);
		const user = await this.createUser({
			email,
			passwordHash, // Pass the hash to createUser
			enabled: true,
			// createdAt will be defaulted by createUser
			hilCount: 5,
			hilBudget: 1,
			// functionConfig and llmConfig will be defaulted by createUser
		});

		this.passwordHashes.set(user.id, passwordHash); // Still maintain separate map for auth logic
		return user; // user object from createUser now includes passwordHash
	}

	async updatePassword(userId: string, newPassword: string): Promise<void> {
		const userIndex = this.users.findIndex((u) => u.id === userId);
		if (userIndex === -1) {
			throw new Error(`User with ID ${userId} not found.`);
		}
		const passwordHash = await bcrypt.hash(newPassword, 10);
		this.passwordHashes.set(userId, passwordHash);
		// Update the user object in the array as well
		if (this.users[userIndex]) {
			this.users[userIndex].passwordHash = passwordHash;
		}
	}
	users: User[] = [singleUser];

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

	async disableUser(userId: string): Promise<void> {
		const user = await this.getUser(userId);
		user.enabled = false;
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

	async ensureSingleUser(): Promise<void> {}

	getSingleUser(): User {
		return singleUser;
	}
}
