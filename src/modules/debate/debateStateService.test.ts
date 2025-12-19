import { expect } from 'chai';
import { SINGLE_USER_ID } from '#modules/memory/inMemoryUserService';
import type { DebateResult, DebateState } from '#shared/debate/debate.model';
import type { User } from '#shared/user/user.model';
import { runAsUser } from '#user/userContext';
import type { DebateStateService } from './debateStateService';

export const SINGLE_USER: User = {
	enabled: true,
	admin: false,
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	chat: {
		enabledLLMs: {},
		defaultLLM: '',
		temperature: 1,
	},
	id: SINGLE_USER_ID,
	name: 'John Doe',
	email: 'user@domain.com',
	functionConfig: {},
	createdAt: new Date(),
};

export const USER_A: User = {
	id: 'user-a-id',
	name: 'User A',
	email: 'usera@example.com',
	enabled: true,
	admin: false,
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	chat: {
		enabledLLMs: {},
		defaultLLM: '',
		temperature: 1,
	},
	functionConfig: {},
	createdAt: new Date(),
};

export const USER_B: User = {
	id: 'user-b-id',
	name: 'User B',
	email: 'userb@example.com',
	enabled: true,
	admin: false,
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	chat: {
		enabledLLMs: {},
		defaultLLM: '',
		temperature: 1,
	},
	functionConfig: {},
	createdAt: new Date(),
};

function createSampleDebate(overrides: Partial<DebateState> = {}): DebateState {
	return {
		debateId: 'test-debate-id',
		userId: SINGLE_USER_ID,
		topic: 'Should we use microservices?',
		phase: 'initial',
		currentRound: 1,
		rounds: [],
		debaters: [
			{ id: 'debater-1', name: 'Architect', type: 'llm', model: 'claude-sonnet-4-5' },
			{ id: 'debater-2', name: 'Critic', type: 'llm', model: 'gpt-4o' },
		],
		config: {
			maxRounds: 5,
			hitlEnabled: true,
		},
		startTime: Date.now(),
		...overrides,
	};
}

function createSampleResult(debateId: string): DebateResult {
	return {
		debateId,
		topic: 'Should we use microservices?',
		synthesizedAnswer: {
			answer: 'Microservices are recommended for this use case.',
			keyPoints: [
				{ agentId: 'debater-1', points: ['Scalability', 'Team autonomy'] },
				{ agentId: 'debater-2', points: ['Consider ops cost'] },
			],
			citations: [],
			confidence: 0.85,
		},
		verifiedAnswer: {
			originalAnswer: 'Microservices are recommended.',
			verifiedAnswer: 'Microservices are recommended for this use case.',
			claims: [{ claim: 'Microservices scale better', status: 'verified' }],
			corrections: [],
			citations: [],
		},
		rounds: [],
		roundCount: 3,
		consensusReached: true,
		hitlInvoked: false,
		executionTimeMs: 45000,
	};
}

export function runDebateStateServiceTests(createService: () => DebateStateService, beforeEachHook: () => Promise<void> | void = () => {}): void {
	let service: DebateStateService;

	async function expectError(promise: Promise<any>, code?: string) {
		try {
			await promise;
			expect.fail('Expected promise to reject but it resolved.');
		} catch (error: any) {
			expect(error).to.be.an('Error');
			if (code) {
				expect(error).to.have.property('code', code);
			}
		}
	}

	const runWithTestUser = (testFn: () => Promise<void>) => {
		return () => runAsUser(SINGLE_USER, testFn);
	};

	beforeEach(async () => {
		await beforeEachHook();
		service = createService();
	});

	// ============================================================================
	// Create and Get Tests
	// ============================================================================

	it(
		'should create and get a debate',
		runWithTestUser(async () => {
			const debate = createSampleDebate();

			const created = await service.createDebate(debate);
			expect(created.debateId).to.equal(debate.debateId);
			expect(created.topic).to.equal(debate.topic);
			expect(created.userId).to.equal(SINGLE_USER_ID);

			const loaded = await service.getDebate(debate.debateId);
			expect(loaded).to.not.be.null;
			expect(loaded!.debateId).to.equal(debate.debateId);
			expect(loaded!.topic).to.equal(debate.topic);
		}),
	);

	it(
		'should return null for non-existent debate',
		runWithTestUser(async () => {
			const loaded = await service.getDebate('non-existent-id');
			expect(loaded).to.be.null;
		}),
	);

	it(
		'should throw error when creating debate without ID',
		runWithTestUser(async () => {
			const debate = createSampleDebate({ debateId: '' });
			await expectError(service.createDebate(debate));
		}),
	);

	// ============================================================================
	// Update Tests
	// ============================================================================

	it(
		'should update a debate',
		runWithTestUser(async () => {
			const debate = createSampleDebate();
			await service.createDebate(debate);

			const updated = await service.updateDebate(debate.debateId, {
				phase: 'debate',
				currentRound: 2,
			});

			expect(updated.phase).to.equal('debate');
			expect(updated.currentRound).to.equal(2);
			expect(updated.topic).to.equal(debate.topic); // Unchanged fields preserved
		}),
	);

	it(
		'should update rounds array',
		runWithTestUser(async () => {
			const debate = createSampleDebate();
			await service.createDebate(debate);

			const round = {
				round: 1,
				positions: [
					{
						agentId: 'debater-1',
						position: 'Microservices are the way to go.',
						confidence: 0.9,
						reasoning: 'Better scalability.',
						citations: [],
						codeTraces: [],
						toolCalls: [],
					},
				],
				toolCalls: [],
				consensusReached: false,
				timestamp: Date.now(),
			};

			const updated = await service.updateDebate(debate.debateId, {
				rounds: [round],
				currentRound: 2,
			});

			expect(updated.rounds).to.have.length(1);
			expect(updated.rounds[0].positions[0].position).to.equal('Microservices are the way to go.');
		}),
	);

	it(
		'should throw error when updating non-existent debate',
		runWithTestUser(async () => {
			await expectError(service.updateDebate('non-existent-id', { phase: 'debate' }), 'NOT_FOUND');
		}),
	);

	// ============================================================================
	// List Tests
	// ============================================================================

	it(
		'should list debates for the current user',
		runWithTestUser(async () => {
			// Create multiple debates
			for (let i = 1; i <= 3; i++) {
				await service.createDebate(
					createSampleDebate({
						debateId: `debate-${i}`,
						startTime: Date.now() - i * 1000, // Stagger start times
					}),
				);
			}

			const result = await service.listDebates();
			expect(result.debates).to.have.length(3);
			expect(result.hasMore).to.be.false;

			// Should be sorted by startTime desc (newest first)
			expect(result.debates[0].debateId).to.equal('debate-1');
		}),
	);

	it(
		'should paginate debates correctly',
		runWithTestUser(async () => {
			// Create 5 debates
			for (let i = 1; i <= 5; i++) {
				await service.createDebate(
					createSampleDebate({
						debateId: `debate-${i}`,
						startTime: Date.now() - i * 1000,
					}),
				);
			}

			// Get first page
			const page1 = await service.listDebates(undefined, undefined, 2);
			expect(page1.debates).to.have.length(2);
			expect(page1.hasMore).to.be.true;
			expect(page1.debates[0].debateId).to.equal('debate-1');
			expect(page1.debates[1].debateId).to.equal('debate-2');

			// Get second page
			const page2 = await service.listDebates(undefined, page1.debates[1].debateId, 2);
			expect(page2.debates).to.have.length(2);
			expect(page2.hasMore).to.be.true;
			expect(page2.debates[0].debateId).to.equal('debate-3');
		}),
	);

	// ============================================================================
	// Delete Tests
	// ============================================================================

	it(
		'should delete a debate',
		runWithTestUser(async () => {
			const debate = createSampleDebate();
			await service.createDebate(debate);

			await service.deleteDebate(debate.debateId);

			const loaded = await service.getDebate(debate.debateId);
			expect(loaded).to.be.null;
		}),
	);

	it(
		'should throw error when deleting non-existent debate',
		runWithTestUser(async () => {
			await expectError(service.deleteDebate('non-existent-id'), 'NOT_FOUND');
		}),
	);

	// ============================================================================
	// Result Tests
	// ============================================================================

	it(
		'should save and get debate result',
		runWithTestUser(async () => {
			const debate = createSampleDebate();
			await service.createDebate(debate);

			const result = createSampleResult(debate.debateId);
			await service.saveResult(debate.debateId, result);

			const loaded = await service.getResult(debate.debateId);
			expect(loaded).to.not.be.null;
			expect(loaded!.debateId).to.equal(debate.debateId);
			expect(loaded!.consensusReached).to.equal(true);
			expect(loaded!.synthesizedAnswer.confidence).to.equal(0.85);
		}),
	);

	it(
		'should return null for debate without result',
		runWithTestUser(async () => {
			const debate = createSampleDebate();
			await service.createDebate(debate);

			const loaded = await service.getResult(debate.debateId);
			expect(loaded).to.be.null;
		}),
	);

	it(
		'should delete result when debate is deleted',
		runWithTestUser(async () => {
			const debate = createSampleDebate();
			await service.createDebate(debate);

			const result = createSampleResult(debate.debateId);
			await service.saveResult(debate.debateId, result);

			await service.deleteDebate(debate.debateId);

			const loaded = await service.getResult(debate.debateId);
			expect(loaded).to.be.null;
		}),
	);

	// ============================================================================
	// Authorization Tests
	// ============================================================================

	it('should not allow user B to view user A debate', async () => {
		// Create debate as user A
		await runAsUser(USER_A, async () => {
			const debate = createSampleDebate({ debateId: 'user-a-debate', userId: USER_A.id });
			await service.createDebate(debate);
		});

		// Try to load as user B
		await runAsUser(USER_B, async () => {
			await expectError(service.getDebate('user-a-debate'), 'UNAUTHORIZED');
		});
	});

	it('should not allow user B to update user A debate', async () => {
		// Create debate as user A
		await runAsUser(USER_A, async () => {
			const debate = createSampleDebate({ debateId: 'user-a-debate-2', userId: USER_A.id });
			await service.createDebate(debate);
		});

		// Try to update as user B
		await runAsUser(USER_B, async () => {
			await expectError(service.updateDebate('user-a-debate-2', { phase: 'debate' }), 'UNAUTHORIZED');
		});
	});

	it('should not allow user B to delete user A debate', async () => {
		// Create debate as user A
		await runAsUser(USER_A, async () => {
			const debate = createSampleDebate({ debateId: 'user-a-debate-3', userId: USER_A.id });
			await service.createDebate(debate);
		});

		// Try to delete as user B
		await runAsUser(USER_B, async () => {
			await expectError(service.deleteDebate('user-a-debate-3'), 'UNAUTHORIZED');
		});
	});

	it('should only list debates for the current user', async () => {
		// Create debate as user A
		await runAsUser(USER_A, async () => {
			await service.createDebate(createSampleDebate({ debateId: 'debate-a', userId: USER_A.id }));
		});

		// Create debate as user B
		await runAsUser(USER_B, async () => {
			await service.createDebate(createSampleDebate({ debateId: 'debate-b', userId: USER_B.id }));
		});

		// List as user A should only see user A's debate
		await runAsUser(USER_A, async () => {
			const result = await service.listDebates();
			expect(result.debates).to.have.length(1);
			expect(result.debates[0].debateId).to.equal('debate-a');
		});

		// List as user B should only see user B's debate
		await runAsUser(USER_B, async () => {
			const result = await service.listDebates();
			expect(result.debates).to.have.length(1);
			expect(result.debates[0].debateId).to.equal('debate-b');
		});
	});
}
