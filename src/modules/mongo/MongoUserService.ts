import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
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
		// 1. Fetch the user by email.
		// Note: This relies on the `getUserByEmail` method being correctly implemented.
		// If `getUserByEmail` is not yet implemented, this method will not function as intended.
		const user = await this.getUserByEmail(email);

		// 2. Handle user not found.
		if (!user) {
			throw new NotFound(`User with email ${email} not found`);
		}

		// 3. Check if the user account is configured for password authentication.
		if (!user.passwordHash) {
			throw new Error('Invalid credentials (user account is not configured for password authentication)');
		}

		// 4. Compare the provided password with the stored hash.
		const isValid = await bcrypt.compare(password, user.passwordHash);

		// 5. Handle invalid password.
		if (!isValid) {
			throw new Error('Invalid credentials (password mismatch)');
		}

		// 6. If the password is valid, attempt to update the user's `lastLoginAt` field.
		// This operation should not block the authentication success if it fails,
		// but an error should be logged.
		try {
			await this.usersCollection.updateOne(
				{ _id: user.id }, // Assumes user.id is the string _id stored in the collection
				{ $set: { lastLoginAt: new Date() } },
			);
		} catch (error) {
			// Log the error but do not let it fail the overall authentication process.
			// Using console.error as a basic logging mechanism as per requirements.
			// A more robust logging solution could be integrated if available in the class.
			console.error(`Error updating lastLoginAt for user ${user.id}: `, error);
		}

		// 7. Return the user object.
		// The returned user object will reflect the state *before* the lastLoginAt update
		// if the update was performed directly on the database without re-fetching.
		// This is acceptable as per the requirements.
		return user;
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
