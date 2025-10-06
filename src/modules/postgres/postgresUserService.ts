import { randomUUID } from 'node:crypto';
import type { ExpressionBuilder, Insertable, Selectable, Updateable } from 'kysely';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { ChatSettings, LLMServicesConfig, User } from '#shared/user/user.model';
import { AbstractUserService } from '#user/abstractUserService';
import { currentUser } from '#user/userContext';
import { type Database, type UsersTable, db } from './db';

export class PostgresUserService extends AbstractUserService {
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
			admin: row.admin,
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
		if (Object.hasOwn(updates, 'admin')) dbUpdate.admin = updates.admin;
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
		const returnedUser = this.docToUser(updatedRow);
		if (this.singleUser && this.singleUser.id === targetUserId) {
			this.singleUser = returnedUser;
		}
		return returnedUser;
	}

	async listUsers(): Promise<User[]> {
		const rows = await db.selectFrom('users').selectAll().orderBy('email', 'asc').execute();
		return rows.map((row) => this.docToUser(row));
	}
}
