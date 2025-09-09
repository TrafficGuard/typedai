import { timeStamp } from 'node:console';
import * as bcrypt from 'bcrypt';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { User } from '#shared/user/user.model';
import { envVar } from '#utils/env-var';
import { isSingleUser } from './userContext';
import { UserService } from './userService';

export abstract class AbstractUserService implements UserService {
	abstract getUser(userId: string): Promise<User>;
	abstract getUserByEmail(email: string): Promise<User | null>;
	abstract createUser(user: Partial<User>): Promise<User>;
	abstract updateUser(updates: Partial<User>, userId?: string): Promise<User>;
	abstract listUsers(): Promise<User[]>;

	protected singleUser: User | undefined;

	async disableUser(userId: string): Promise<void> {
		const user = await this.getUser(userId);
		await this.updateUser({ enabled: false }, user.id);
	}

	getSingleUser(): User {
		if (!this.singleUser) throw new Error('Single user not initialized');
		return this.singleUser;
	}

	/**
	 * When running the application in single user mode ensure there is a user account
	 * created with the email of the SINGLE_USER_EMAIL environment variable.
	 */
	async ensureSingleUser(): Promise<void> {
		if (!isSingleUser()) return;
		if (this.singleUser) return;

		const email = envVar('SINGLE_USER_EMAIL');
		const users = await this.listUsers();

		const user = users.find((user) => user.email === email);
		if (user) {
			this.singleUser = user;
			logger.info(`Found single user for email ${email} id: ${this.singleUser.id}`);
			return;
		}

		this.singleUser = await this.createUser({
			email,
			functionConfig: {},
			llmConfig: {},
			enabled: true,
			hilCount: 5,
			hilBudget: 1,
		});
		logger.info(`Created single user for email ${email} id: ${this.singleUser.id}`);
	}

	@span({ email: 0 })
	async authenticateUser(email: string, password: string): Promise<User> {
		let user: User | null = null;
		try {
			user = await this.getUserByEmail(email);
		} catch (e) {
			throw new Error('Error loading user', { cause: e });
		}

		if (!user) throw new Error('Invalid credentials');
		if (!user.passwordHash) throw new Error('Invalid credentials (no hash)');

		const isValid = await bcrypt.compare(password, user.passwordHash);
		if (!isValid) throw new Error('Invalid credentials');
		await this.updateUser({ lastLoginAt: new Date() }, user.id);
		return user;
	}

	@span({ userId: 0 })
	async updatePassword(userId: string, newPassword: string): Promise<void> {
		const passwordHash = await bcrypt.hash(newPassword, 10);
		await this.updateUser({ passwordHash }, userId);
	}

	@span({ email: 0 })
	async createUserWithPassword(email: string, password: string): Promise<User> {
		const existingUser = await this.getUserByEmail(email);
		if (existingUser) {
			logger.debug(`User ${email} already exists`);
			throw new Error(`User already exists with email ${email}`);
		}

		const passwordHash = await bcrypt.hash(password, 10);
		return this.createUser({
			email,
			passwordHash,
			enabled: true,
			createdAt: new Date(),
			hilCount: 5,
			hilBudget: 1,
			functionConfig: {},
			llmConfig: {},
		});
	}
}
