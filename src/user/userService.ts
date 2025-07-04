import type { User } from '#shared/user/user.model';

export interface UserService {
	getUser(userId: string): Promise<User>;

	getUserByEmail(email: string): Promise<User | null>;

	createUser(user: Partial<User>): Promise<User>;

	/**
	 * Authenticate user with email/password
	 * @throws Error if credentials are invalid
	 */
	authenticateUser(email: string, password: string): Promise<User>;

	/**
	 * Create new user with email/password
	 * @throws Error if user already exists
	 */
	createUserWithPassword(email: string, password: string): Promise<User>;

	/**
	 * Update user's password
	 * @throws Error if user not found
	 */
	updatePassword(userId: string, newPassword: string): Promise<void>;

	/**
	 * When running the application in single user mode ensure there is a user account
	 * created with the email of the SINGLE_USER_EMAIL environment variable.
	 */
	ensureSingleUser(): Promise<void>;

	getSingleUser(): User;

	/**
	 * @param updates
	 * @param userId The current user if undefined. Admins can edit other users.
	 */
	updateUser(updates: Partial<User>, userId?: string): Promise<User>;

	disableUser(userId: string): Promise<void>;

	listUsers(): Promise<User[]>;
}
