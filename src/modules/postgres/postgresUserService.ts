import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import type { ExpressionBuilder, Insertable, Selectable, Updateable } from 'kysely';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { ChatSettings, LLMServicesConfig, User } from '#shared/model/user.model';
import { currentUser } from '#user/userContext';
import type { UserService } from '#user/userService';
import { type Database, type UsersTable, db } from './db';

export class PostgresUserService implements UserService {
	private docToUser(row: Selectable<UsersTable>): User {
		const parsedLlmConfig: LLMServicesConfig = row.llm_config_serialized ? JSON.parse(row.llm_config_serialized) : {};
		const parsedChatConfig = row.chat_config_serialized ? JSON.parse(row.chat_config_serialized) : {};
		const chat: ChatSettings = {
			enabledLLMs: parsedChatConfig.enabledLLMs ?? {},
			defaultLLM: parsedChatConfig.defaultLLM,
			temperature: parsedChatConfig.temperature,
			topP: parsedChatConfig.topP,
			topK: parsedChatConfig.topK,
			presencePenalty: parsedChatConfig.presencePenalty,
			frequencyPenalty: parsedChatConfig.frequencyPenalty,
		};
		const parsedFunctionConfig: Record<string, Record<string, any>> = row.function_config_serialized ? JSON.parse(row.function_config_serialized) : {};

		return {
			id: row.id,
			name: row.name ?? '',
			email: row.email,
			enabled: row.enabled,
			passwordHash: row.password_hash ?? undefined,
			createdAt: new Date(row.created_at),
			lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : undefined,
			hilBudget: row.hil_budget,
			hilCount: row.hil_count,
			llmConfig: parsedLlmConfig,
			chat,
			functionConfig: parsedFunctionConfig,
		};
	}

	private userToDbInsert(user: Partial<User>): Insertable<UsersTable> {
		// Basic implementation focusing on essential fields for a potential createUser
		return {
			id: user.id || randomUUID(),
			email: user.email!, // Assumes email is validated to be present before this call
			name: user.name ?? null,
			enabled: user.enabled ?? true,
			password_hash: user.passwordHash ?? null,
			hil_budget: user.hilBudget ?? 0,
			hil_count: user.hilCount ?? 0,
			created_at: user.createdAt instanceof Date ? user.createdAt : new Date(),
			last_login_at: user.lastLoginAt instanceof Date ? user.lastLoginAt : null,
			llm_config_serialized: JSON.stringify(user.llmConfig ?? {}),
			chat_config_serialized: JSON.stringify(
				user.chat ?? { enabledLLMs: {}, defaultLLM: '', temperature: 1, topP: 1, topK: 50, frequencyPenalty: 0, presencePenalty: 0 },
			),
			function_config_serialized: JSON.stringify(user.functionConfig ?? {}),
		};
	}

	private userToDbUpdate(updates: Partial<User>): Omit<Updateable<UsersTable>, 'id' | 'email' | 'created_at'> {
		// Basic implementation
		const dbUpdate: Partial<Omit<Updateable<UsersTable>, 'id' | 'email' | 'created_at'>> = {};

		if (Object.hasOwn(updates, 'name')) dbUpdate.name = updates.name ?? null;
		if (Object.hasOwn(updates, 'enabled')) dbUpdate.enabled = updates.enabled;
		if (Object.hasOwn(updates, 'passwordHash')) dbUpdate.password_hash = updates.passwordHash ?? null;
		if (Object.hasOwn(updates, 'hilBudget')) dbUpdate.hil_budget = updates.hilBudget;
		if (Object.hasOwn(updates, 'hilCount')) dbUpdate.hil_count = updates.hilCount;
		if (Object.hasOwn(updates, 'lastLoginAt')) dbUpdate.last_login_at = updates.lastLoginAt instanceof Date ? updates.lastLoginAt : null;
		if (Object.hasOwn(updates, 'llmConfig')) {
			dbUpdate.llm_config_serialized = updates.llmConfig ? JSON.stringify(updates.llmConfig) : null;
		}
		if (Object.hasOwn(updates, 'chat')) {
			dbUpdate.chat_config_serialized = updates.chat ? JSON.stringify(updates.chat) : null;
		}
		if (Object.hasOwn(updates, 'functionConfig')) {
			dbUpdate.function_config_serialized = updates.functionConfig ? JSON.stringify(updates.functionConfig) : null;
		}
		return dbUpdate;
	}

	@span({ userId: 0 })
	async getUser(userId: string): Promise<User> {
		const row = await db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst();

		if (!row) {
			logger.warn(`User with id ${userId} not found`);
			throw new Error(`User with id ${userId} not found`);
		}
		return this.docToUser(row);
	}

	@span({ email: 0 })
	async getUserByEmail(email: string): Promise<User | null> {
		const row = await db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();

		if (!row) {
			return null;
		}
		return this.docToUser(row);
	}

	async createUser(user: Partial<User>): Promise<User> {
		if (!user.email) throw new Error('User email is required for creation.');
		const existingUser = await this.getUserByEmail(user.email);
		if (existingUser) throw new Error('User with this email already exists');

		if (user.name === null || user.name === undefined) {
			user.name = 'Test User';
		}
		const dbData = this.userToDbInsert(user);
		const insertedRow = await db.insertInto('users').values(dbData).returningAll().executeTakeFirstOrThrow();
		return this.docToUser(insertedRow);
	}

	async authenticateUser(email: string, password: string): Promise<User> {
		const user = await this.getUserByEmail(email);
		if (!user || !user.passwordHash) throw new Error('Invalid credentials');
		const isValid = await bcrypt.compare(password, user.passwordHash);
		if (!isValid) throw new Error('Invalid credentials');
		// lastLoginAt is updated via updateUser, which also fetches the user again.
		// This ensures the returned user object includes the updated lastLoginAt.
		const updatedUser = await this.updateUser({ lastLoginAt: new Date() }, user.id);
		return updatedUser;
	}

	async createUserWithPassword(email: string, password: string): Promise<User> {
		const existingUser = await this.getUserByEmail(email);
		if (existingUser) throw new Error('User already exists');
		const passwordHash = await bcrypt.hash(password, 10);
		const newUserPartial: Partial<User> = {
			email,
			passwordHash,
			enabled: true,
			hilBudget: 0, // Default value
			hilCount: 0, // Default value
			llmConfig: {}, // Default value
			chat: { enabledLLMs: {}, defaultLLM: '', temperature: 1, topP: 1, topK: 50, frequencyPenalty: 0, presencePenalty: 0 }, // Default value
			functionConfig: {}, // Default value
		};
		return this.createUser(newUserPartial);
	}

	async updatePassword(userId: string, newPassword: string): Promise<void> {
		const passwordHash = await bcrypt.hash(newPassword, 10);
		await this.updateUser({ passwordHash }, userId);
	}

	async ensureSingleUser(): Promise<void> {
		// This method's behavior is different in Postgres compared to Firestore/InMemory.
		// In a typical Postgres multi-user setup, "single user mode" isn't managed at this service level
		// in the same way (e.g., by creating a user from ENV vars if not present).
		// If a specific single-user setup is required for Postgres (e.g., based on environment variables
		// to find or create THE single user), that logic would need to be added here,
		// potentially populating a class member like 'this.singleUserInstance'.
		// For now, this method logs information and is effectively a no-op regarding DB changes.
		logger.info(
			'PostgresUserService: ensureSingleUser called. In a standard Postgres deployment, single-user mode is typically managed via application configuration or deployment strategy. This service assumes multi-user capabilities by default.',
		);
		// No database operations are performed by default for this method in PostgresUserService.
		return Promise.resolve();
	}

	getSingleUser(): User {
		// This method is intended to return a pre-defined or uniquely identified "single user"
		// typically initialized or identified by `ensureSingleUser`.
		// As the current Postgres `ensureSingleUser` is informational and doesn't define/load
		// a specific single user instance into this service, this method cannot fulfill its purpose.
		logger.warn(
			'PostgresUserService: getSingleUser called. This method is not fully functional in the current PostgresUserService configuration as ensureSingleUser does not define/load a specific single user instance.',
		);
		throw new Error(
			'getSingleUser cannot reliably return a single user in PostgresUserService without specific single-user initialization logic in ensureSingleUser (e.g., loading a user by a configured ID/email into a service instance).',
		);
		// If a 'this.singleUserInstance: User | undefined;' property existed and was populated by ensureSingleUser:
		// if (!this.singleUserInstance) {
		//     throw new Error('Single user has not been initialized. ensureSingleUser might need to be called or configured.');
		// }
		// return this.singleUserInstance;
	}

	async updateUser(updates: Partial<User>, userId?: string): Promise<User> {
		const targetUserId = userId ?? currentUser().id;
		await this.getUser(targetUserId); // Ensures user exists, throws if not.

		const dbUpdateData = this.userToDbUpdate(updates);

		// Check if there's anything to update.
		// The `lastLoginAt` field might be the only update and could result in an empty `dbUpdateData`
		// if `userToDbUpdate` doesn't explicitly handle non-serialized fields like Date objects directly.
		// However, `userToDbUpdate` as defined *does* handle `lastLoginAt`.
		// This check is more about preventing an unnecessary DB call if `updates` was truly empty or only contained non-updatable fields.
		if (Object.keys(dbUpdateData).length === 0) {
			// If lastLoginAt was the only thing in updates, userToDbUpdate would have processed it.
			// If updates was genuinely empty or only contained e.g. 'id', then dbUpdateData would be empty.
			// In such a case, just return the current user data.
			return this.getUser(targetUserId);
		}

		const updatedRow = await db.updateTable('users').set(dbUpdateData).where('id', '=', targetUserId).returningAll().executeTakeFirstOrThrow();
		return this.docToUser(updatedRow);
	}

	async disableUser(userId: string): Promise<void> {
		await this.updateUser({ enabled: false }, userId);
	}

	async listUsers(): Promise<User[]> {
		const rows = await db.selectFrom('users').selectAll().orderBy('email', 'asc').execute();
		return rows.map((row) => this.docToUser(row));
	}
}
