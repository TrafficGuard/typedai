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
			email: user.email!, // Assuming email is always provided for new user
			name: user.name ?? null,
			enabled: user.enabled ?? true,
			password_hash: user.passwordHash ?? null,
			hil_budget: user.hilBudget ?? 0,
			hil_count: user.hilCount ?? 0,
			created_at: user.createdAt || new Date(),
			last_login_at: user.lastLoginAt || null,
			llm_config_serialized: user.llmConfig ? JSON.stringify(user.llmConfig) : null,
			chat_config_serialized: user.chat ? JSON.stringify(user.chat) : null,
			function_config_serialized: user.functionConfig ? JSON.stringify(user.functionConfig) : null,
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
		if (Object.hasOwn(updates, 'lastLoginAt')) dbUpdate.last_login_at = updates.lastLoginAt ?? null;
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
		throw new Error('Not implemented yet (createUser)');
	}

	async authenticateUser(email: string, password: string): Promise<User> {
		throw new Error('Not implemented yet (authenticateUser)');
	}

	async createUserWithPassword(email: string, password: string): Promise<User> {
		throw new Error('Not implemented yet (createUserWithPassword)');
	}

	async updatePassword(userId: string, newPassword: string): Promise<void> {
		throw new Error('Not implemented yet (updatePassword)');
	}

	async ensureSingleUser(): Promise<void> {
		throw new Error('Not implemented yet (ensureSingleUser)');
	}

	getSingleUser(): User {
		throw new Error('Not implemented yet (getSingleUser)');
	}

	async updateUser(updates: Partial<User>, userId?: string): Promise<User> {
		throw new Error('Not implemented yet (updateUser)');
	}

	async disableUser(userId: string): Promise<void> {
		throw new Error('Not implemented yet (disableUser)');
	}

	async listUsers(): Promise<User[]> {
		throw new Error('Not implemented yet (listUsers)');
	}
}
