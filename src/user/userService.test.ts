import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import type { User } from '#shared/user/user.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { UserService } from '#user/userService';

// Important: Do not call setupConditionalLoggerOutput again from the implementation specific test files.

chai.use(chaiAsPromised);
const { expect, assert } = chai;

// Helper function to create user objects with default values
function createUserWithDefaults(overrides: Partial<User>): User {
	const randomSuffix = Math.random().toString(36).substring(2, 9);
	const defaultUser: User = {
		id: overrides.id || `test-id-${randomSuffix}`,
		name: overrides.name || 'Test User',
		email: overrides.email || `test-${randomSuffix}@example.com`,
		enabled: typeof overrides.enabled === 'boolean' ? overrides.enabled : true,
		hilBudget: typeof overrides.hilBudget === 'number' ? overrides.hilBudget : 0,
		hilCount: typeof overrides.hilCount === 'number' ? overrides.hilCount : 0,
		createdAt: overrides.createdAt || new Date(),
		// Optional fields from User model, ensure they are handled
		passwordHash: overrides.passwordHash,
		lastLoginAt: overrides.lastLoginAt,
		llmConfig: overrides.llmConfig || {},
		chat: overrides.chat || {
			enabledLLMs: {},
			defaultLLM: '',
			temperature: 1,
			topP: 1,
			topK: 50,
			frequencyPenalty: 0,
			presencePenalty: 0,
		},
		functionConfig: overrides.functionConfig || {},
	};

	// Merge overrides into defaultUser. For nested objects, this will replace the default if provided in overrides.
	return { ...defaultUser, ...overrides };
}

export function runUserServiceTests(
	createService: () => Promise<UserService> | UserService,
	beforeEachHook?: () => Promise<void> | void,
	afterEachHook?: () => Promise<void> | void,
): void {
	let service: UserService;

	describe('UserService Shared Tests', () => {
		beforeEach(async () => {
			if (beforeEachHook) {
				await beforeEachHook();
			}
			service = await createService();
		});

		afterEach(async () => {
			sinon.restore();
			if (afterEachHook) {
				await afterEachHook();
			}
		});

		describe('#admin', () => {
			// should load admin value
			// only admins can create admins
		});

		describe('#getUser', () => {
			it('should retrieve an existing user by ID', async () => {
				const userData = createUserWithDefaults({ name: 'Specific User' });
				const createdUser = await service.createUser(userData);
				expect(createdUser.id).to.be.a('string');

				const retrievedUser = await service.getUser(createdUser.id);
				expect(retrievedUser).to.not.be.null;

				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { id: _originalId, createdAt: originalCreatedAt, ...comparableUserData } = userData;
				expect(retrievedUser).to.deep.include(comparableUserData);
				expect(retrievedUser?.id).to.equal(createdUser.id);
				if (retrievedUser?.createdAt && originalCreatedAt) {
					expect(retrievedUser.createdAt).to.be.a('date');
					expect(retrievedUser.createdAt.getTime()).to.be.closeTo(originalCreatedAt.getTime(), 5000);
				}
			});

			it('should throw an error if user is not found', async () => {
				await expect(service.getUser('nonexistent-id')).to.be.rejectedWith(Error);
			});
		});

		describe('#getUserByEmail', () => {
			it('should retrieve an existing user by email', async () => {
				const email = `unique-${Date.now()}@example.com`;
				const userData = createUserWithDefaults({ email });
				const createdUser = await service.createUser(userData);

				const retrievedUser = await service.getUserByEmail(email);
				expect(retrievedUser).to.not.be.null;
				expect(retrievedUser?.email).to.equal(email);

				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { id: _originalId, createdAt: originalCreatedAt, ...comparableUserData } = userData;
				expect(retrievedUser).to.deep.include(comparableUserData);
				expect(retrievedUser?.id).to.equal(createdUser.id);
				if (retrievedUser?.createdAt && originalCreatedAt) {
					expect(retrievedUser.createdAt).to.be.a('date');
					expect(retrievedUser.createdAt.getTime()).to.be.closeTo(originalCreatedAt.getTime(), 5000);
				}
			});

			it('should return null if user is not found by email', async () => {
				const user = await service.getUserByEmail('nonexistent@example.com');
				expect(user).to.be.null;
			});
		});

		describe('#createUser', () => {
			it('should create a new user with provided details', async () => {
				const userData = createUserWithDefaults({ name: 'New User', email: 'newuser@example.com' });
				const createdUser = await service.createUser(userData);

				expect(createdUser).to.exist;
				expect(createdUser.id).to.be.a('string');
				expect(createdUser.createdAt).to.be.a('date');

				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { id: _originalId, createdAt: originalCreatedAt, ...comparableUserData } = userData;
				expect(createdUser).to.deep.include(comparableUserData);
				if (createdUser.createdAt && originalCreatedAt) {
					expect(createdUser.createdAt.getTime()).to.be.closeTo(originalCreatedAt.getTime(), 5000);
				}
				// If the service generates its own ID (like Firestore), createdUser.id might not equal userData.id
				// So, we don't assert expect(createdUser.id).to.equal(userData.id) here.

				const retrievedUser = await service.getUser(createdUser.id);
				expect(retrievedUser).to.deep.equal(createdUser);
			});

			it('should create a new user with minimal details (e.g., only email)', async () => {
				const minimalData = createUserWithDefaults({ email: 'minimal@example.com', name: undefined }); // Explicitly undefined for name
				const createdUser = await service.createUser(minimalData);

				expect(createdUser).to.exist;
				expect(createdUser.id).to.be.a('string');
				expect(createdUser.email).to.equal(minimalData.email);
				// Check default values for other fields if applicable, e.g., enabled should be true
				expect(createdUser.enabled).to.be.true;
				expect(createdUser.name).to.equal('Test User'); // From createUserWithDefaults default
			});
		});

		describe('#updateUser', () => {
			it('should update user details', async () => {
				const userData = createUserWithDefaults({});
				const createdUser = await service.createUser(userData);

				const updates: Partial<User> = { name: 'Updated Name', hilBudget: 100 };
				const updatedUser = await service.updateUser(updates, createdUser.id);

				expect(updatedUser).to.exist;
				expect(updatedUser.name).to.equal(updates.name);
				expect(updatedUser.hilBudget).to.equal(updates.hilBudget);
				expect(updatedUser.email).to.equal(createdUser.email); // Email should not change unless specified

				const retrievedUser = await service.getUser(createdUser.id);
				expect(retrievedUser?.name).to.equal(updates.name);
				expect(retrievedUser?.hilBudget).to.equal(updates.hilBudget);
			});

			it('should throw an error if user to update is not found', async () => {
				await expect(service.updateUser({ name: 'New Name' }, 'nonexistent-id')).to.be.rejectedWith(Error);
			});
		});

		describe('#disableUser', () => {
			it('should disable a user (set enabled to false)', async () => {
				const userData = createUserWithDefaults({ enabled: true });
				const createdUser = await service.createUser(userData);
				expect(createdUser.enabled).to.be.true;

				await service.disableUser(createdUser.id);
				// No need to check the result of disableUser as it's void.
				// We'll verify by fetching the user again.

				const retrievedUser = await service.getUser(createdUser.id);
				expect(retrievedUser?.enabled).to.be.false;
			});

			it('should throw an error if user to disable is not found', async () => {
				await expect(service.disableUser('nonexistent-id')).to.be.rejectedWith(Error);
			});
		});

		describe('#listUsers', () => {
			it('should list all created users', async () => {
				// Clear existing users or ensure a clean state if possible (depends on service implementation and hooks)
				// For this test, we assume we can create users and they will be listed.
				const user1Data = createUserWithDefaults({ email: 'list1@example.com' });
				const user2Data = createUserWithDefaults({ email: 'list2@example.com' });
				const user1 = await service.createUser(user1Data);
				const user2 = await service.createUser(user2Data);

				const users = await service.listUsers();
				expect(users).to.be.an('array').with.lengthOf.at.least(2); // Use at.least if other users might exist

				// Check if the created users are in the list
				// Note: deep.include on array of objects checks for presence of objects with matching properties.
				// This might require users to be fully formed as returned by createUser.
				expect(users).to.deep.include.members([user1, user2]);
			});

			it('should return an empty array if no users exist', async () => {
				// This test relies on the `beforeEachHook` of the concrete service implementation
				// (e.g., inMemoryUserService.test.ts's hook that clears `userService.users`)
				// to ensure a clean state where no users exist.
				const users = await service.listUsers();
				expect(users).to.be.an('array').that.is.empty;
			});
		});

		describe('#createUserWithPassword', () => {
			it('should create a user that can then be retrieved', async () => {
				const userData = createUserWithDefaults({ email: `pwd-${Date.now()}@example.com` });
				const password = 'strongPassword123';
				const createdUser = await service.createUserWithPassword(userData.email, password);

				expect(createdUser).to.exist;
				expect(createdUser.id).to.be.a('string');
				expect(createdUser.email).to.equal(userData.email);
				expect(createdUser.passwordHash).to.be.a('string').and.not.empty; // Password hash should be set

				const retrievedUser = await service.getUser(createdUser.id);
				expect(retrievedUser).to.deep.equal(createdUser);
			});

			it('should throw an error if a user with the same email already exists', async () => {
				const email = `existing-${Date.now()}@example.com`;
				const userData = createUserWithDefaults({ email });
				await service.createUserWithPassword(userData.email, 'password123'); // Create the first user

				const sameEmailUserData = createUserWithDefaults({ email }); // Attempt to create another with same email
				await expect(service.createUserWithPassword(sameEmailUserData.email, 'newPassword456')).to.be.rejectedWith(Error);
			});
		});

		describe('#authenticateUser', () => {
			it('should authenticate a user with correct email and password', async () => {
				const email = `auth-${Date.now()}@example.com`;
				const password = 'passwordToAuth';
				const userData = createUserWithDefaults({ email });
				await service.createUserWithPassword(userData.email, password);

				const authenticatedUser = await service.authenticateUser(email, password);
				expect(authenticatedUser).to.exist;
				expect(authenticatedUser.email).to.equal(email);
			});

			it('should throw an error for incorrect password', async () => {
				const email = `auth-fail-${Date.now()}@example.com`;
				const password = 'correctPassword';
				const userData = createUserWithDefaults({ email });
				await service.createUserWithPassword(userData.email, password);

				await expect(service.authenticateUser(email, 'wrongPassword')).to.be.rejectedWith(Error);
			});

			it('should throw an error for non-existent email', async () => {
				await expect(service.authenticateUser('nonexistent-auth@example.com', 'password')).to.be.rejectedWith(Error);
			});
		});

		describe('#updatePassword', () => {
			it('should allow updating password and re-authentication with new password', async () => {
				const email = `updatepwd-${Date.now()}@example.com`;
				const oldPassword = 'oldPassword123';
				const newPassword = 'newPassword456';
				const userData = createUserWithDefaults({ email });

				const user = await service.createUserWithPassword(userData.email, oldPassword);
				await service.updatePassword(user.id, newPassword);

				// Attempt authentication with new password
				const authenticatedUser = await service.authenticateUser(email, newPassword);
				expect(authenticatedUser).to.exist;
				expect(authenticatedUser.id).to.equal(user.id);

				// Attempt authentication with old password should fail
				await expect(service.authenticateUser(email, oldPassword)).to.be.rejectedWith(Error);
			});

			it('should throw an error if user to update password for is not found', async () => {
				await expect(service.updatePassword('nonexistent-id-pwd', 'newpassword')).to.be.rejectedWith(Error);
			});
		});
	});
}
