import { assert, expect } from 'chai';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { User } from '#user/user';
import { FirestoreUserService } from './firestoreUserService';

describe('FirestoreUserService', () => {
	let userService: FirestoreUserService;

	function createUserWithDefaults(overrides: Partial<User>): User {
		const defaultUser: User = {
			id: '',
			email: '',
			enabled: true,
			hilBudget: 0,
			hilCount: 0,
			createdAt: new Date(),
			llmConfig: {
				anthropicKey: '',
				openaiKey: '',
				groqKey: '',
				togetheraiKey: '',
			},
			chat: {
				enabledLLMs: {},
				defaultLLM: '',
				temperature: 1,
			},
			functionConfig: {},
			// gitlabConfig: {
		};
		return { ...defaultUser, ...overrides };
	}

	beforeEach(async () => {
		userService = new FirestoreUserService();
		await resetFirestoreEmulator();
	});

	describe('getUser', () => {
		it('should retrieve a user by ID', async () => {
			let user = createUserWithDefaults({
				email: 'test@example.com',
				hilBudget: 100,
				createdAt: new Date(),
			});
			user = await userService.createUser(user);
			const retrievedUser = await userService.getUser(user.id);
			expect(retrievedUser).to.deep.equal(user);
		});

		it('should throw an error if user is not found', async () => {
			try {
				await userService.getUser('nonexistent');
				assert.fail('Should throw an Error if user is not found');
			} catch (e) {}
		});
	});

	describe('updateUser', () => {
		it('should update user details', async () => {
			const createUser: Partial<User> = createUserWithDefaults({
				email: 'original@example.com',
			});
			const user = await userService.createUser(createUser);
			await userService.updateUser({ email: 'updated@example.com' }, user.id);
			const updatedUser = await userService.getUser(user.id);
			expect(updatedUser.email).to.equal('updated@example.com');
		});
	});

	describe('disableUser', () => {
		it('should disable a user', async () => {
			let user: Partial<User> = createUserWithDefaults({
				email: 'original@example.com',
				enabled: true,
			});
			user = await userService.createUser(user);
			await userService.disableUser(user.id);
			const disabledUser = await userService.getUser(user.id);
			expect(disabledUser.enabled).to.be.false;
		});
	});

	describe('listUsers', () => {
		it('should list all users', async () => {
			let user1: Partial<User> = createUserWithDefaults({
				email: 'list1@example.com',
			});
			let user2: Partial<User> = createUserWithDefaults({
				email: 'list2@example.com',
			});
			user1 = await userService.createUser(user1);
			user2 = await userService.createUser(user2);
			const users = await userService.listUsers();
			expect(users).to.have.lengthOf(2);
			expect(users).to.deep.include.members([user1, user2]);
		});
	});

	describe('createUser', () => {
		it('should create a new user', async () => {
			const newUser = createUserWithDefaults({
				email: 'create@example.com',
			});
			const createdUser = await userService.createUser(newUser);
			expect(createdUser.email).to.equal(newUser.email);
			const retrievedUser = await userService.getUser(createdUser.id);
			expect(retrievedUser.email).to.equal(newUser.email);
			expect(retrievedUser.llmConfig).to.exist;
		});

		it('should create a minimal new user', async () => {
			const newUser: Partial<User> = {
				email: 'create@example.com',
			};
			const createdUser = await userService.createUser(newUser);
			expect(createdUser.email).to.equal(newUser.email);
			const retrievedUser = await userService.getUser(createdUser.id);
			expect(retrievedUser.email).to.equal(newUser.email);
			expect(retrievedUser.llmConfig).to.exist;
		});
	});
});
