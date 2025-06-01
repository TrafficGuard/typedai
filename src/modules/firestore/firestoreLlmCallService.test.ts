import { expect } from 'chai';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import { runLlmCallServiceTests } from '#llm/llmCallService/llmCallService.test'; // Added import
import { firestoreDb } from '#modules/firestore/firestore';
import { FirestoreLlmCallService } from '#modules/firestore/firestoreLlmCallService';
import { type LlmMessage, system, user } from '#shared/llm/llm.model';
import type { LlmCall } from '#shared/llmCall/llmCall.model';
import type { User } from '#shared/user/user.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';

// Firestore document size limit (slightly under 1 MiB)
const MAX_DOC_SIZE = 1_000_000;
// Threshold for externalizing message part data (e.g., 500KB)
const EXTERNAL_DATA_THRESHOLD = 500_000;
// Subdirectory within agent storage for message data
const MSG_DATA_SUBDIR = 'msgData';
// Prefix for references to externally stored data
const AGENT_REF_PREFIX = 'agentfs://';

// Helper to generate large strings
const generateLargeString = (size: number): string => {
	// Use a character that takes 1 byte in UTF-8
	return 'a'.repeat(size);
};

// Helper to estimate size (mirroring service implementation)
const estimateSize = (data: any): number => {
	return Buffer.byteLength(JSON.stringify(data), 'utf8');
};

const testUser: User = {
	id: 'test-user-123',
	name: 'John Doe',
	email: 'test@example.com',
	enabled: true,
	createdAt: new Date(),
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	chat: { enabledLLMs: {}, defaultLLM: '', temperature: 1, topP: 1, topK: 50, frequencyPenalty: 0, presencePenalty: 0 }, // Ensure chat has default structure
	functionConfig: {},
};

describe('FirestoreLlmCallService', () => {
	setupConditionalLoggerOutput();
	// Run shared tests
	runLlmCallServiceTests(
		() => new FirestoreLlmCallService(), // Factory to create the service
		async () => {
			// beforeEach hook for shared tests
			await resetFirestoreEmulator();
		},
		// No specific afterEach hook needed here for shared tests
	);

	// Firestore-specific tests (keeping existing detailed tests for chunking)
	describe('Firestore Specific Tests', () => {
		let service: FirestoreLlmCallService;

		beforeEach(async () => {
			service = new FirestoreLlmCallService();
			await resetFirestoreEmulator(); // Also reset for Firestore-specific tests
		});

		// Note: Some tests below might be redundant with the shared tests.
		// Review and remove if covered, or keep if they test Firestore specifics not in shared tests.
		// For now, I'm keeping them to preserve detailed chunking verification.

		describe('saveRequest and getCall (Single Document - Firestore Specific)', () => {
			it('should save a small request and retrieve it using getCall, checking Firestore specific fields', async () => {
				const request: CreateLlmRequest = {
					messages: [system('Small system prompt'), user('Small user prompt')],
					description: 'Test description',
					llmId: 'test-llm',
					agentId: 'test-agent',
					userId: testUser.id,
					callStack: 'test > call > stack',
					settings: { temperature: 0.5 }, // Provide some settings
				};

				const savedRequest = await service.saveRequest(request);
				expect(savedRequest).to.have.property('id');
				expect(savedRequest).to.have.property('requestTime');
				expect(savedRequest).to.have.property('llmCallId'); // Firestore specific field
				expect(savedRequest.llmCallId).to.equal(savedRequest.id);
				expect(savedRequest.userId).to.equal(testUser.id);

				const retrievedCall = await service.getCall(savedRequest.id);
				expect(retrievedCall).to.not.be.null;
				expect(retrievedCall!.id).to.equal(savedRequest.id);
				expect(retrievedCall!.llmCallId).to.equal(savedRequest.id);
				expect(retrievedCall!.userId).to.equal(testUser.id);
				expect(retrievedCall!.chunkCount).to.equal(0); // Firestore specific field
				expect(retrievedCall!.messages).to.have.lengthOf(2);
				expect(retrievedCall!.messages[0].content).to.equal(request.messages![0].content);
				expect(retrievedCall!.messages[1].content).to.equal(request.messages![1].content);
				expect(retrievedCall!.description).to.equal(request.description);
			});
		});

		describe('saveResponse (Single Document - Firestore Specific)', () => {
			it('should save a small response and retrieve it, checking Firestore specific fields', async () => {
				const request: CreateLlmRequest = {
					messages: [system('Test system prompt'), user('Test user prompt')],
					description: 'Small test description',
					llmId: 'small-test-llm',
					agentId: 'small-test-agent',
					userId: testUser.id,
					callStack: 'small > test > stack',
					settings: { temperature: 0.5 },
				};
				const savedRequest = await service.saveRequest(request);

				const finalMessages = [...request.messages!, { role: 'assistant', content: 'Small test response' }] as LlmMessage[];
				const responseData: LlmCall = {
					...savedRequest,
					messages: finalMessages,
					cost: 0.01,
					timeToFirstToken: 50,
					totalTime: 200,
					inputTokens: 10,
					outputTokens: 5,
				};

				await service.saveResponse(responseData);

				const retrievedCall = await service.getCall(savedRequest.id);
				expect(retrievedCall).to.not.be.null;
				expect(retrievedCall!.id).to.equal(responseData.id);
				expect(retrievedCall!.llmCallId).to.equal(responseData.id); // Firestore specific
				expect(retrievedCall!.chunkCount).to.equal(0); // Firestore specific
				expect(retrievedCall!.messages).to.have.lengthOf(3);
				expect(retrievedCall!.messages[2].content).to.equal('Small test response');
				expect(retrievedCall!.cost).to.equal(responseData.cost);
				expect(retrievedCall!.userId).to.equal(testUser.id);
			});
		});

		describe('Chunking Logic (saveResponse / getCall - Firestore Specific)', () => {
			it('should chunk a large response and retrieve it correctly, verifying chunk details', async () => {
				const largeContentSize = Math.floor(MAX_DOC_SIZE * 0.7);
				const largeMessage1 = user(generateLargeString(largeContentSize));
				const largeMessage2 = system(generateLargeString(largeContentSize));
				const largeResponseText = generateLargeString(largeContentSize);

				const request: CreateLlmRequest = {
					messages: [largeMessage1, largeMessage2],
					description: 'Large test description',
					llmId: 'large-test-llm',
					agentId: 'large-test-agent',
					userId: testUser.id,
					settings: { temperature: 0.5 },
				};
				const savedRequest = await service.saveRequest(request);

				const finalMessages = [...request.messages!, { role: 'assistant', content: largeResponseText }] as LlmMessage[];
				const responseData: LlmCall = {
					...savedRequest,
					messages: finalMessages,
					cost: 0.5,
					totalTime: 5000,
				};

				const estimatedTotalSize = estimateSize({ ...responseData });
				expect(estimatedTotalSize).to.be.greaterThan(MAX_DOC_SIZE);

				await service.saveResponse(responseData);

				const mainDocRef = firestoreDb().doc(`LlmCall/${savedRequest.id}`);
				const mainDocSnap = await mainDocRef.get();
				expect(mainDocSnap.exists).to.be.true;
				const mainDocData = mainDocSnap.data();
				expect(mainDocData).to.exist;
				expect(mainDocData!.messages).to.be.undefined;
				expect(mainDocData!.chunkCount).to.be.greaterThan(0);
				const expectedChunkCount = mainDocData!.chunkCount;

				const chunksQuery = firestoreDb().collection('LlmCall').where('llmCallId', '==', savedRequest.id).where('chunkIndex', '>', 0);
				const chunksSnapshot = await chunksQuery.get();
				expect(chunksSnapshot.size).to.equal(expectedChunkCount);

				const retrievedCall = await service.getCall(savedRequest.id);
				expect(retrievedCall).to.not.be.null;
				expect(retrievedCall!.id).to.equal(savedRequest.id);
				expect(retrievedCall!.llmCallId).to.equal(savedRequest.id); // Firestore specific
				expect(retrievedCall!.chunkCount).to.equal(expectedChunkCount); // Firestore specific

				expect(retrievedCall!.messages).to.have.lengthOf(3);
				expect(retrievedCall!.messages[0].content).to.equal(largeMessage1.content);
				expect(retrievedCall!.messages[1].content).to.equal(largeMessage2.content);
				expect(retrievedCall!.messages[2].content).to.equal(largeResponseText);
				expect(retrievedCall!.cost).to.equal(responseData.cost);
			});

			it('should throw an error if a single message causes chunk to exceed MAX_DOC_SIZE', async () => {
				// This test is specific to Firestore's internal chunking logic for individual messages
				const oversizedMessageContent = generateLargeString(MAX_DOC_SIZE + 100);
				const oversizedMessage = user(oversizedMessageContent);
				const request: CreateLlmRequest = {
					messages: [oversizedMessage],
					description: 'Oversized message test',
					llmId: 'oversize-llm',
					userId: testUser.id,
					settings: { temperature: 0.5 },
				};
				// FirestoreLlmCallService's saveRequest might throw if a single message is too big for a chunk
				// This depends on how it serializes and splits individual messages.
				// The shared test for large messages checks overall data integrity.
				// This specific test checks Firestore's internal limit for a single message part of a chunk.
				await expect(service.saveRequest(request)).to.be.rejectedWith(Error, /Single message in LlmCall .* causes chunk document to exceed maximum size limit/);
			});
		});

		describe('getLlmCallsForAgent (Mixed Single/Chunked - Firestore Specific)', () => {
			it('should load both single-doc and chunked responses for an agent, sorted correctly', async () => {
				const agentId = 'mixed-test-agent';

				const smallRequest: CreateLlmRequest = {
					agentId,
					messages: [system('Small call system'), user('Small call user')],
					description: 'Small call description',
					llmId: 'small-llm',
					userId: testUser.id,
					settings: { temperature: 0.5 },
				};
				const savedSmallRequest = await service.saveRequest(smallRequest);
				await firestoreDb()
					.doc(`LlmCall/${savedSmallRequest.id}`)
					.update({ requestTime: Date.now() - 2000 });
				const smallResponseMessages = [...smallRequest.messages!, { role: 'assistant', content: 'Small call response' }] as LlmMessage[];
				const smallResponse: LlmCall = { ...savedSmallRequest, requestTime: Date.now() - 2000, messages: smallResponseMessages, cost: 0.01, totalTime: 100 };
				await service.saveResponse(smallResponse);

				await new Promise((resolve) => setTimeout(resolve, 50));
				const largeContentSize = Math.floor(MAX_DOC_SIZE * 0.6);
				const largeRequest: CreateLlmRequest = {
					agentId,
					messages: [user(generateLargeString(largeContentSize))],
					description: 'Large call description',
					llmId: 'large-llm',
					userId: testUser.id,
					settings: { temperature: 0.5 },
				};
				const savedLargeRequest = await service.saveRequest(largeRequest);
				const largeResponseMessages = [...largeRequest.messages!, { role: 'assistant', content: generateLargeString(largeContentSize) }] as LlmMessage[];
				const largeResponse: LlmCall = { ...savedLargeRequest, messages: largeResponseMessages, cost: 0.2, totalTime: 2000 };
				await service.saveResponse(largeResponse);

				await new Promise((resolve) => setTimeout(resolve, 50));
				const smallRequest2: CreateLlmRequest = {
					agentId,
					messages: [system('Small call 2 system'), user('Small call 2 user')],
					description: 'Small call 2 description',
					llmId: 'small-llm-2',
					userId: testUser.id,
					settings: { temperature: 0.5 },
				};
				const savedSmallRequest2 = await service.saveRequest(smallRequest2);
				const smallResponse2Messages = [...smallRequest2.messages!, { role: 'assistant', content: 'Small call 2 response' }] as LlmMessage[];
				const smallResponse2: LlmCall = { ...savedSmallRequest2, messages: smallResponse2Messages, cost: 0.03, totalTime: 300 };
				await service.saveResponse(smallResponse2);

				const calls = await service.getLlmCallsForAgent(agentId);
				expect(calls).to.have.lengthOf(3);
				expect(calls[0].id).to.equal(savedSmallRequest2.id); // Most recent
				expect(calls[1].id).to.equal(savedLargeRequest.id);
				expect(calls[2].id).to.equal(savedSmallRequest.id); // Oldest

				const retrievedLargeCall = calls.find((c) => c.id === savedLargeRequest.id)!;
				expect(retrievedLargeCall.chunkCount).to.be.greaterThan(0); // Firestore specific
				expect(retrievedLargeCall.messages).to.have.lengthOf(2);
				expect(retrievedLargeCall.messages[0].content).to.equal(largeRequest.messages![0].content);

				const retrievedSmallCall1 = calls.find((c) => c.id === savedSmallRequest.id)!;
				expect(retrievedSmallCall1.chunkCount).to.equal(0); // Firestore specific
				expect(retrievedSmallCall1.messages).to.have.lengthOf(3);
			});
		});

		describe('delete (Firestore Specific)', () => {
			it('should delete a single-document LlmCall', async () => {
				const request: CreateLlmRequest = {
					messages: [user('delete me')],
					description: 'delete test',
					llmId: 'delete-llm',
					userId: testUser.id,
					settings: { temperature: 0.5 },
				};
				const savedRequest = await service.saveRequest(request);
				const responseMessages = [...request.messages!, { role: 'assistant', content: 'deleted response' }] as LlmMessage[];
				const response: LlmCall = { ...savedRequest, messages: responseMessages };
				await service.saveResponse(response);

				await service.delete(savedRequest.id);

				const retrievedCall = await service.getCall(savedRequest.id);
				expect(retrievedCall).to.be.null;
			});

			it('should delete a chunked LlmCall and its chunks', async () => {
				const largeContentSize = Math.floor(MAX_DOC_SIZE * 0.6);
				const request: CreateLlmRequest = {
					messages: [user(generateLargeString(largeContentSize))],
					description: 'delete chunked test',
					llmId: 'delete-chunked-llm',
					userId: testUser.id,
					settings: { temperature: 0.5 },
				};
				const savedRequest = await service.saveRequest(request);
				const responseMessages = [...request.messages!, { role: 'assistant', content: generateLargeString(largeContentSize) }] as LlmMessage[];
				const response: LlmCall = { ...savedRequest, messages: responseMessages };
				await service.saveResponse(response);

				const chunksQueryBefore = firestoreDb().collection('LlmCall').where('llmCallId', '==', savedRequest.id).where('chunkIndex', '>', 0);
				const chunksSnapshotBefore = await chunksQueryBefore.get();
				expect(chunksSnapshotBefore.empty).to.be.false;

				await service.delete(savedRequest.id);

				const retrievedCall = await service.getCall(savedRequest.id);
				expect(retrievedCall).to.be.null;
				const mainDocSnapAfter = await firestoreDb().doc(`LlmCall/${savedRequest.id}`).get();
				expect(mainDocSnapAfter.exists).to.be.false;
				const chunksSnapshotAfter = await chunksQueryBefore.get();
				expect(chunksSnapshotAfter.empty).to.be.true;
			});
		});
	});
});
