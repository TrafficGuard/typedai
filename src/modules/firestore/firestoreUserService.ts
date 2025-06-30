import { type DocumentSnapshot, Firestore } from '@google-cloud/firestore';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { User } from '#shared/user/user.model';
import { AbstractUserService } from '#user/abstractUserService';
import { currentUser } from '#user/userContext';
import { envVar } from '#utils/env-var';

export const USERS_COLLECTION = 'Users';

/*** Google Firestore implementation of UserService*/
export class FirestoreUserService extends AbstractUserService {
	db: Firestore;

	constructor() {
		super();
		this.db = new Firestore({
			projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'demo-typedai' : envVar('GCLOUD_PROJECT'),
			databaseId: process.env.DATABASE_NAME,
			ignoreUndefinedProperties: true,
		});
	}

	@span({ userId: 0 })
	async getUser(userId: string): Promise<User> {
		const docRef = this.db.doc(`Users/${userId}`);
		const docSnap: DocumentSnapshot = await docRef.get();
		if (!docSnap.exists) {
			throw new Error(`User ${userId} does not exist`);
		}
		const data = docSnap.data();
		if (!data) {
			throw new Error(`User data for ${userId} is undefined`);
		}
		return this.docToUser(data, userId);
	}

	docToUser(data: any, id: string): User {
		const user: User = {
			id,
			name: data.name,
			email: data.email,
			enabled: data.enabled,
			hilBudget: data.hilBudget,
			hilCount: data.hilCount,
			createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
			lastLoginAt: data.lastLoginAt?.toDate ? data.lastLoginAt.toDate() : data.lastLoginAt,
			passwordHash: data.passwordHash, // Ensure passwordHash is included
			llmConfig: data.llmConfig ?? {}, // Ensure llmConfig is included
			functionConfig: data.functionConfig ?? {}, // Ensure functionConfig is included
			chat: data.chat, // Will be handled by the nullish coalescing operator below
		};
		user.chat ??= {
			enabledLLMs: {},
			defaultLLM: (data as any).defaultChatLlmId, // backward compat
			temperature: 1,
			topP: 1,
			topK: 50,
			frequencyPenalty: 0,
			presencePenalty: 0,
		};
		user.chat.enabledLLMs ??= {};
		user.chat.defaultLLM ??= '';
		user.chat.temperature ??= 1; // Align with test default
		user.chat.topP ??= 1;
		user.chat.topK ??= 50;
		user.chat.frequencyPenalty ??= 0;
		user.chat.presencePenalty ??= 0;
		return user;
	}

	@span({ email: 0 })
	async getUserByEmail(email: string): Promise<User | null> {
		const querySnapshot = await this.db.collection(USERS_COLLECTION).where('email', '==', email).get();
		const users = querySnapshot.docs.map((doc) => {
			const data = doc.data();
			return this.docToUser(data, doc.id);
		});
		if (users.length === 0) return null;
		if (users.length > 1) throw new Error(`More than one user with email ${email} found`);
		return users[0];
	}

	@span({ email: 0 })
	async createUser(user: Partial<User>): Promise<User> {
		const docRef = this.db.collection(USERS_COLLECTION).doc(); // Firestore generates ID

		const dataToSet: Partial<User> = {
			name: user.name ?? 'Test User',
			email: user.email,
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

		// Remove properties that are undefined, so Firestore doesn't store them as nulls
		const finalDataToSet = Object.fromEntries(Object.entries(dataToSet).filter(([, value]) => value !== undefined));

		try {
			await docRef.set(finalDataToSet);
			return this.getUser(docRef.id);
		} catch (error) {
			logger.error(error, 'Error creating user');
			throw error;
		}
	}

	@span()
	async updateUser(updates: Partial<User>, userId?: string): Promise<User> {
		userId ??= currentUser().id;
		// TODO should do the read/update in a transaction
		const currentUserData = await this.getUser(userId);
		const chatUpdates = updates.chat;
		const updatedUser = { ...currentUserData, ...updates, id: userId };
		const userDocRef = this.db.doc(`Users/${userId}`);
		try {
			await userDocRef.update(updatedUser);
			if (this.singleUser) this.singleUser = updatedUser;
			return updatedUser;
		} catch (error) {
			logger.error(error, 'Error updating user');
			throw error;
		}
	}

	@span()
	async listUsers(): Promise<User[]> {
		const querySnapshot = await this.db.collection(USERS_COLLECTION).get();
		return querySnapshot.docs.map((doc) => {
			const data = doc.data() as User;
			return this.docToUser(data, doc.id);
		});
	}
}
