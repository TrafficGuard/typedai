import { randomUUID } from 'node:crypto';
import type { Collection, Db, WithId } from 'mongodb';
import { NotFound } from '#shared/errors';
import type { User } from '#shared/user/user.model';
import { AbstractUserService } from '#user/abstractUserService';
import { isSingleUser } from '#user/userContext';

const USERS_COLLECTION = 'users';

export class MongoUserService extends AbstractUserService {
	private readonly usersCollection: Collection<any>;

	constructor(private db: Db) {
		super();
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

	async listUsers(): Promise<User[]> {
		const docs = await this.usersCollection.find({}).toArray();

		if (!docs || docs.length === 0) {
			return [];
		}

		return docs.map((doc) => {
			const { _id, ...userProps } = doc as WithId<any>; // Cast for _id handling

			const user: User = {
				id: _id as string, // MongoDB _id can be ObjectId, ensure it's string for User model
				name: userProps.name,
				email: userProps.email,
				enabled: userProps.enabled,
				passwordHash: userProps.passwordHash, // This can be undefined in the User model
				createdAt: userProps.createdAt, // MongoDB driver typically converts BSON Date to JS Date
				lastLoginAt: userProps.lastLoginAt, // Can be undefined
				hilBudget: userProps.hilBudget ?? 0,
				hilCount: userProps.hilCount ?? 0,
				llmConfig: userProps.llmConfig ?? {},
				chat: userProps.chat ?? {},
				functionConfig: userProps.functionConfig ?? {},
			};
			return user;
		});
	}
}
