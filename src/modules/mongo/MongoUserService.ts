import type { User } from '#shared/user/user.model';
import type { UserService } from '#user/userService';

export class MongoUserService implements UserService {
	async getUser(userId: string): Promise<User> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getUserByEmail(email: string): Promise<User | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async createUser(user: Partial<User>): Promise<User> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
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
