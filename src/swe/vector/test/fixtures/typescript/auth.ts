import * as bcrypt from 'bcrypt';

// Mock jwt for realistic test fixture (not actual jsonwebtoken)
const jwt = {
	sign: (payload: any, secret: string, options?: any): string => 'mock-jwt-token',
	verify: (token: string, secret: string): any => ({ userId: 'mock-user-id' }),
};

/**
 * User authentication service
 * Handles user login, token generation, and password validation
 */
export class AuthService {
	private readonly secretKey: string;
	private readonly tokenExpiration: string;

	constructor(secretKey: string, tokenExpiration = '24h') {
		this.secretKey = secretKey;
		this.tokenExpiration = tokenExpiration;
	}

	/**
	 * Authenticates a user with email and password
	 * Returns JWT token if credentials are valid
	 */
	async authenticateUser(email: string, password: string): Promise<string | null> {
		// Validate email format
		if (!this.isValidEmail(email)) {
			throw new Error('Invalid email format');
		}

		// TODO: Fetch user from database
		const user = await this.getUserByEmail(email);

		if (!user) {
			return null;
		}

		// Verify password
		const isValidPassword = await bcrypt.compare(password, user.hashedPassword);

		if (!isValidPassword) {
			return null;
		}

		// Generate JWT token
		return this.generateToken(user.id, user.email, user.role);
	}

	/**
	 * Generates a JWT token for authenticated user
	 * Includes user ID, email, and role in the payload
	 */
	generateToken(userId: string, email: string, role: string): string {
		const payload = {
			userId,
			email,
			role,
			issuedAt: Date.now(),
		};

		return jwt.sign(payload, this.secretKey, {
			expiresIn: this.tokenExpiration,
		});
	}

	/**
	 * Verifies a JWT token and returns the decoded payload
	 * Throws error if token is invalid or expired
	 */
	verifyToken(token: string): { userId: string; email: string; role: string } {
		try {
			const decoded = jwt.verify(token, this.secretKey) as any;
			return {
				userId: decoded.userId,
				email: decoded.email,
				role: decoded.role,
			};
		} catch (error) {
			throw new Error('Invalid or expired token');
		}
	}

	/**
	 * Hashes a plain text password using bcrypt
	 * Uses salt rounds of 10 for security
	 */
	async hashPassword(password: string): Promise<string> {
		const saltRounds = 10;
		return await bcrypt.hash(password, saltRounds);
	}

	/**
	 * Validates email format using regex
	 */
	private isValidEmail(email: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	}

	/**
	 * Fetches user from database by email
	 * This is a placeholder - should be implemented with actual database
	 */
	private async getUserByEmail(email: string): Promise<any> {
		// TODO: Implement database query
		return null;
	}
}
