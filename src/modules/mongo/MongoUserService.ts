import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import type { Collection, Db, WithId } from 'mongodb';
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
		// 1. Input validation: Check if email is provided.
		if (!email) {
			throw new Error('Email must be provided.');
		}

		// 2. Query the usersCollection for a user with the matching email.
		const doc = await this.usersCollection.findOne({ email: email });

		// 3. If no document is found, return null.
		if (!doc) {
			return null;
		}

		// 4. If a document is found, transform it into a User object.
		// The 'doc' object from MongoDB will have an '_id' field.
		// userProps will contain all other fields from the document.
		const { _id, ...userProps } = doc as WithId<any>; // Using WithId<any> for type hint on _id

		// Construct the User object, ensuring defaults for nested configuration objects.
		const user: User = {
			id: _id as string, // _id is stored as a string, consistent with createUser
			name: userProps.name,
			email: userProps.email,
			enabled: userProps.enabled,
			passwordHash: userProps.passwordHash, // Undefined if not in doc, matches User model
			createdAt: userProps.createdAt, // Assumed to be Date object from driver
			lastLoginAt: userProps.lastLoginAt, // Assumed to be Date object or undefined
			hilBudget: userProps.hilBudget,
			hilCount: userProps.hilCount,
			llmConfig: userProps.llmConfig ?? {}, // Default to empty object if undefined in DB
			chat: userProps.chat ?? {}, // Default to empty object if undefined in DB
			functionConfig: userProps.functionConfig ?? {}, // Default to empty object if undefined in DB
		};

		return user;
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
		// 1. Check if a user with the given email already exists.
		// This relies on getUserByEmail being implemented.
		const existingUser = await this.getUserByEmail(email);

		// 2. If the user exists, throw an error.
		if (existingUser) {
			throw new Error(`User with email ${email} already exists`);
		}

		// 3. If the user does not exist, hash the password.
		const passwordHash = await bcrypt.hash(password, 10);

		// 4. Create the new user with email and hashed password.
		// The createUser method handles setting other default fields.
		return this.createUser({
			email,
			passwordHash,
		});
	}

	async updatePassword(userId: string, newPassword: string): Promise<void> {
		if (!userId || !newPassword) {
			throw new Error('User ID and new password must be provided.');
		}

		// Verify user existence (getUser will throw NotFound if user doesn't exist)
		await this.getUser(userId);

		const passwordHash = await bcrypt.hash(newPassword, 10);

		await this.usersCollection.updateOne({ _id: userId }, { $set: { passwordHash: passwordHash } });
	}

	async ensureSingleUser(): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	getSingleUser(): User {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async updateUser(updates: Partial<User>, userId: string): Promise<User> {
		// 1. Validate userId parameter
		if (!userId) {
			throw new Error('User ID must be provided for update.');
		}

		// 2. Retrieve the existing user document to ensure it exists
		const existingDoc = await this.usersCollection.findOne({ _id: userId });

		// 3. Handle user not found
		if (!existingDoc) {
			throw new NotFound(`User with ID ${userId} not found`);
		}

		// 4. Prepare valid updates, excluding immutable or specially managed fields
		// 'id' is the application-level ID (maps to _id in DB), 'email' and 'createdAt' are generally not updated this way.
		// '_id' itself should not be in 'updates' but good to be defensive.
		const {
			id, // Exclude 'id' from User model
			email, // Exclude 'email'
			createdAt, // Exclude 'createdAt'
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			_id, // Exclude '_id' if it somehow came in `updates`
			...validUpdates
		} = updates as any; // Use 'as any' as per requirement example to handle potential extra fields

		// 5. Check if there are any actual fields to update after filtering
		if (Object.keys(validUpdates).length === 0) {
			// No valid fields to update, return the current user data
			return this.getUser(userId);
		}

		// 6. Perform the update operation
		await this.usersCollection.updateOne({ _id: userId }, { $set: validUpdates });

		// 7. Fetch and return the updated user object to ensure freshness
		return this.getUser(userId);
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
