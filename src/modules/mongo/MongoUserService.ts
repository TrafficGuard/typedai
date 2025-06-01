import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { NotFound } from '#shared/errors';
import type { User } from '#shared/user/user.model';
import type { UserService } from '#user/userService';

const USERS_COLLECTION = 'users';

export class MongoUserService implements UserService {
	private readonly usersCollection: Collection<any>;

	constructor(private db: Db) {
		this.usersCollection = this.db.collection(USERS_COLLECTION);
	}

	async getUser(userId: string): Promise<User> {
		if (!userId) {
			throw new Error('User ID must be provided.');
		}

		const doc = await this.usersCollection.findOne({ _id: userId });

		if (!doc) {
			throw new NotFound(`User with ID ${userId} not found`);
		}

		const { _id, ...userProps } = doc;

		return {
			id: _id as string,
			...userProps,
		} as User;
	}

	async getUserByEmail(email: string): Promise<User | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async createUser(user: Partial<User>): Promise<User> {
		const userId = user.id ?? randomUUID();

		if (user.email === undefined || user.email === null) {
			throw new Error('Email is required to create a user.');
		}

		const finalUser: User = {
			id: userId,
			name: user.name ?? '',
			email: user.email,
			enabled: user.enabled ?? true,
			passwordHash: user.passwordHash,
			createdAt: user.createdAt ?? new Date(),
			lastLoginAt: user.lastLoginAt ?? new Date(),
			hilBudget: user.hilBudget ?? 0,
			hilCount: user.hilCount ?? 0,
			llmConfig: user.llmConfig ?? {},
			chat: user.chat ?? {},
			functionConfig: user.functionConfig ?? {},
		};

		const { id, ...userProps } = finalUser;
		const docToInsert = {
			_id: finalUser.id,
			...userProps,
		};

		await this.usersCollection.insertOne(docToInsert);
		return finalUser;
	}

	async authenticateUser(email: string, password: string): Promise<User> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async createUserWithPassword(email: string, password: string): Promise<User> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async updatePassword(userId: string, newPassword: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async ensureSingleUser(): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	getSingleUser(): User {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async updateUser(updates: Partial<User>, userId?: string): Promise<User> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async disableUser(userId: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async listUsers(): Promise<User[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}
}
