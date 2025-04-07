import { expect } from 'chai';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { LlmMessage, system, user } from '#llm/llm';
import { CreateLlmRequest, LlmCall } from '#llm/llmCallService/llmCall';
import { LlmCallService } from '#llm/llmCallService/llmCallService';
import { firestoreDb } from '#modules/firestore/firestore';
import { FirestoreLlmCallService } from '#modules/firestore/firestoreLlmCallService';
import { User } from '#user/user'; // Import User from the correct location
import { setCurrentUser } from '#user/userService/userContext'; // Keep setCurrentUser import

// Firestore document size limit (use same constant as service)
const MAX_DOC_SIZE = 1_000_000;

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
	email: 'test@example.com',
	enabled: true,
	createdAt: new Date(),
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {}, // Added missing property
	chat: {}, // Added missing property
	functionConfig: {}, // Added missing property
};

describe('FirestoreLlmCallService', () => {
	let service: FirestoreLlmCallService; // Use concrete type for testing private methods if needed, but stick to interface for usage

	beforeEach(async () => {
		service = new FirestoreLlmCallService(); // Instantiate the concrete class
		await resetFirestoreEmulator();
		// setCurrentUser(testUser); // Set a mock user for tests needing userId
	});

	afterEach(() => {
		// setCurrentUser(null); // Clear the mock user
	});

	describe('saveRequest and getCall (Single Document)', () => {
		it('should save a small request and retrieve it using getCall', async () => {
			const request: CreateLlmRequest = {
				messages: [system('Small system prompt'), user('Small user prompt')],
				description: 'Test description',
				llmId: 'test-llm',
				agentId: 'test-agent',
				userId: testUser.id, // Explicitly set userId
				callStack: 'test > call > stack',
			};

			const savedRequest = await service.saveRequest(request);
			expect(savedRequest).to.have.property('id');
			expect(savedRequest).to.have.property('requestTime');
			expect(savedRequest).to.have.property('llmCallId');
			expect(savedRequest.llmCallId).to.equal(savedRequest.id);
			expect(savedRequest.userId).to.equal(testUser.id);

			const retrievedCall = await service.getCall(savedRequest.id);
			expect(retrievedCall).to.not.be.null;
			// Add checks for id, llmCallId, userId, chunkCount
			expect(retrievedCall!.id).to.equal(savedRequest.id);
			expect(retrievedCall!.llmCallId).to.equal(savedRequest.id); // Verify llmCallId on retrieval
			expect(retrievedCall!.userId).to.equal(testUser.id);
			expect(retrievedCall!.chunkCount).to.equal(0); // Should be 0 for non-chunked
			// Check messages
			expect(retrievedCall!.messages).to.have.lengthOf(2);
			expect(retrievedCall!.messages[0].role).to.equal(request.messages![0].role);
			expect(retrievedCall.messages[0].content).to.equal(request.messages[0].content);
			expect(retrievedCall.messages[1].role).to.equal(request.messages[1].role);
			expect(retrievedCall.messages[1].content).to.equal(request.messages[1].content);
			expect(retrievedCall.description).to.equal(request.description);
			expect(retrievedCall.llmId).to.equal(request.llmId);
			expect(retrievedCall!.agentId).to.equal(request.agentId);
			expect(retrievedCall!.callStack).to.equal(request.callStack);
		});

		it('should return null from getCall for a non-existent ID', async () => {
			const retrievedCall = await service.getCall('non-existent-id');
			expect(retrievedCall).to.be.null;
		});
	});

	describe('saveResponse (Single Document)', () => {
		it('should save a small response and retrieve it using getCall', async () => {
			const request: CreateLlmRequest = {
				messages: [system('Test system prompt'), user('Test user prompt')],
				description: 'Small test description',
				llmId: 'small-test-llm',
				agentId: 'small-test-agent',
				userId: testUser.id,
				callStack: 'small > test > stack',
			};
			const savedRequest = await service.saveRequest(request);

			// Add the assistant response directly to the messages array
			const finalMessages = [...request.messages!, { role: 'assistant', content: 'Small test response' }] as LlmMessage[];

			const responseData: LlmCall = {
				...savedRequest, // Includes id, requestTime, llmCallId, userId etc.
				messages: finalMessages, // Use the updated messages array
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
			expect(retrievedCall!.llmCallId).to.equal(responseData.id);
			// Verify messages array includes the responseText as the last assistant message
			expect(retrievedCall!.messages).to.have.lengthOf(3); // system, user, assistant
			expect(retrievedCall!.messages[0].role).to.equal('system');
			expect(retrievedCall!.messages[0].content).to.equal(request.messages![0].content);
			expect(retrievedCall!.messages[1].role).to.equal('user');
			expect(retrievedCall!.messages[1].content).to.equal(request.messages![1].content);
			expect(retrievedCall!.messages[2].role).to.equal('assistant');
			expect(retrievedCall!.messages[2].content).to.equal('Small test response'); // Check content directly
			// Verify other fields
			expect(retrievedCall!.description).to.equal(responseData.description);
			expect(retrievedCall!.llmId).to.equal(responseData.llmId);
			expect(retrievedCall!.agentId).to.equal(responseData.agentId);
			expect(retrievedCall!.callStack).to.equal(responseData.callStack);
			expect(retrievedCall!.cost).to.equal(responseData.cost);
			expect(retrievedCall!.timeToFirstToken).to.equal(responseData.timeToFirstToken);
			expect(retrievedCall!.totalTime).to.equal(responseData.totalTime);
			expect(retrievedCall!.inputTokens).to.equal(responseData.inputTokens);
			expect(retrievedCall!.outputTokens).to.equal(responseData.outputTokens);
			expect(retrievedCall!.userId).to.equal(testUser.id);
			expect(retrievedCall!.chunkCount).to.equal(0);
		});
	});

	describe('Chunking Logic (saveResponse / getCall)', () => {
		it('should chunk a large response and retrieve it correctly', async () => {
			const largeContentSize = Math.floor(MAX_DOC_SIZE * 0.7); // ~700KB content per message
			const largeMessage1 = user(generateLargeString(largeContentSize));
			const largeMessage2 = system(generateLargeString(largeContentSize));
			const largeResponseText = generateLargeString(largeContentSize);

			const request: CreateLlmRequest = {
				messages: [largeMessage1, largeMessage2],
				description: 'Large test description',
				llmId: 'large-test-llm',
				agentId: 'large-test-agent',
				userId: testUser.id, // Explicitly set userId
			};
			const savedRequest = await service.saveRequest(request);

			// Add the assistant response directly to the messages array
			const finalMessages = [...request.messages!, { role: 'assistant', content: largeResponseText }] as LlmMessage[];

			const responseData: LlmCall = {
				...savedRequest,
				messages: finalMessages, // Use the updated messages array
				cost: 0.5,
				totalTime: 5000,
			};

			// Estimate expected size (approximate)
			const estimatedTotalSize = estimateSize({ ...responseData }); // Estimate with final messages
			expect(estimatedTotalSize).to.be.greaterThan(MAX_DOC_SIZE);

			await service.saveResponse(responseData);

			// Verify main document exists but doesn't contain messages
			const mainDocRef = firestoreDb().doc(`LlmCall/${savedRequest.id}`);
			const mainDocSnap = await mainDocRef.get();
			expect(mainDocSnap.exists).to.be.true;
			const mainDocData = mainDocSnap.data();
			expect(mainDocData).to.exist;
			expect(mainDocData!.messages).to.be.undefined; // Messages should be in chunks
			expect(mainDocData!.chunkCount).to.be.greaterThan(0);
			const expectedChunkCount = mainDocData!.chunkCount; // Store for later verification

			// Verify chunk documents exist
			const chunksQuery = firestoreDb().collection('LlmCall').where('llmCallId', '==', savedRequest.id).where('chunkIndex', '>', 0);
			const chunksSnapshot = await chunksQuery.get();
			expect(chunksSnapshot.size).to.equal(expectedChunkCount);

			// Retrieve using getCall (should reconstruct)
			const retrievedCall = await service.getCall(savedRequest.id);
			expect(retrievedCall).to.not.be.null;
			expect(retrievedCall!.id).to.equal(savedRequest.id);
			expect(retrievedCall!.llmCallId).to.equal(savedRequest.id);
			expect(retrievedCall!.chunkCount).to.equal(expectedChunkCount); // Verify chunkCount on retrieved object

			// Verify reconstructed messages
			expect(retrievedCall!.messages).to.have.lengthOf(3); // user, system, assistant
			expect(retrievedCall!.messages[0].role).to.equal(largeMessage1.role);
			expect(retrievedCall!.messages[0].content).to.equal(largeMessage1.content);
			expect(retrievedCall!.messages[1].role).to.equal(largeMessage2.role);
			expect(retrievedCall!.messages[1].content).to.equal(largeMessage2.content);
			expect(retrievedCall!.messages[2].role).to.equal('assistant');
			expect(retrievedCall!.messages[2].content).to.equal(largeResponseText);

			// Verify other fields
			expect(retrievedCall!.description).to.equal(request.description);
			expect(retrievedCall!.llmId).to.equal(request.llmId);
			expect(retrievedCall!.agentId).to.equal(request.agentId);
			expect(retrievedCall!.cost).to.equal(responseData.cost);
			expect(retrievedCall!.totalTime).to.equal(responseData.totalTime);
		});

		it('should throw an error if a single message exceeds MAX_DOC_SIZE', async () => {
			const oversizedMessage = user(generateLargeString(MAX_DOC_SIZE + 100));
			const request: CreateLlmRequest = {
				messages: [oversizedMessage],
				description: 'Oversized message test',
				llmId: 'oversize-llm',
				userId: testUser.id, // Explicitly set userId
			};

			// The error should be thrown during saveRequest because the initial message is too large
			await expect(service.saveRequest(request)).to.be.rejectedWith(Error, /Single message in LlmCall .* causes chunk document to exceed maximum size limit/);

			// No need to proceed to saveResponse if saveRequest fails as expected
		});
	});

	describe('getLlmCallsForAgent (Mixed Single/Chunked)', () => {
		it('should load both single-doc and chunked responses for an agent, sorted correctly', async () => {
			const agentId = 'mixed-test-agent';

			// 1. Small Call (will be single doc)
			const smallRequest: CreateLlmRequest = {
				agentId,
				messages: [system('Small call system'), user('Small call user')],
				description: 'Small call description',
				llmId: 'small-llm',
				userId: testUser.id, // Explicitly set userId
			};
			const savedSmallRequest = await service.saveRequest(smallRequest);
			// Make requestTime slightly older
			savedSmallRequest.requestTime = Date.now() - 2000;
			await firestoreDb().doc(`LlmCall/${savedSmallRequest.id}`).update({ requestTime: savedSmallRequest.requestTime }); // Update time manually for test order
			const smallResponseMessages = [...smallRequest.messages!, { role: 'assistant', content: 'Small call response' }] as LlmMessage[];
			const smallResponse: LlmCall = {
				...savedSmallRequest,
				messages: smallResponseMessages,
				cost: 0.01,
				totalTime: 100,
			};
			await service.saveResponse(smallResponse); // Saved as single doc

			// 2. Large Call (will be chunked) - make it more recent
			await new Promise((resolve) => setTimeout(resolve, 50)); // Ensure time difference
			const largeContentSize = Math.floor(MAX_DOC_SIZE * 0.6);
			const largeRequest: CreateLlmRequest = {
				agentId,
				messages: [user(generateLargeString(largeContentSize))],
				description: 'Large call description',
				llmId: 'large-llm',
				userId: testUser.id, // Explicitly set userId
			};
			const savedLargeRequest = await service.saveRequest(largeRequest);
			const largeResponseMessages = [...largeRequest.messages!, { role: 'assistant', content: generateLargeString(largeContentSize) }] as LlmMessage[];
			const largeResponse: LlmCall = {
				...savedLargeRequest,
				messages: largeResponseMessages, // Make response large too
				cost: 0.2,
				totalTime: 2000,
			};
			await service.saveResponse(largeResponse); // Saved as chunked doc

			// 3. Another Small Call (most recent)
			await new Promise((resolve) => setTimeout(resolve, 50)); // Ensure time difference
			const smallRequest2: CreateLlmRequest = {
				agentId,
				messages: [system('Small call 2 system'), user('Small call 2 user')],
				description: 'Small call 2 description',
				llmId: 'small-llm-2',
				userId: testUser.id, // Explicitly set userId
			};
			const savedSmallRequest2 = await service.saveRequest(smallRequest2);
			const smallResponse2Messages = [...smallRequest2.messages!, { role: 'assistant', content: 'Small call 2 response' }] as LlmMessage[];
			const smallResponse2: LlmCall = {
				...savedSmallRequest2,
				messages: smallResponse2Messages,
				cost: 0.03,
				totalTime: 300,
			};
			await service.saveResponse(smallResponse2); // Saved as single doc

			// --- Verification ---
			const calls = await service.getLlmCallsForAgent(agentId);
			expect(calls).to.have.lengthOf(3); // Should retrieve all three

			// Verify sorting (most recent first)
			expect(calls[0].id).to.equal(savedSmallRequest2.id);
			expect(calls[1].id).to.equal(savedLargeRequest.id);
			expect(calls[2].id).to.equal(savedSmallRequest.id);
			expect(calls[0].requestTime).to.be.greaterThan(calls[1].requestTime);
			expect(calls[1].requestTime).to.be.greaterThan(calls[2].requestTime);

			// Verify reconstruction of the large call
			const retrievedLargeCall = calls[1];
			expect(retrievedLargeCall.chunkCount).to.be.greaterThan(0);
			expect(retrievedLargeCall.messages).to.have.lengthOf(2); // user, assistant
			expect(retrievedLargeCall.messages[0].role).to.equal('user');
			expect(retrievedLargeCall.messages[0].content).to.equal(largeRequest.messages![0].content);
			expect(retrievedLargeCall.messages[1].role).to.equal('assistant');
			expect(retrievedLargeCall.messages[1].content).to.equal(largeResponse.messages![1].content); // Check content from messages

			// Verify reconstruction of small calls
			const retrievedSmallCall1 = calls[2]; // <-- Add this line
			expect(retrievedSmallCall1.chunkCount).to.equal(0);
			expect(retrievedSmallCall1.messages).to.have.lengthOf(3); // system, user, assistant
			expect(retrievedSmallCall1.messages[2].content).to.equal(smallResponse.messages![2].content); // Check content from messages

			const retrievedSmallCall2 = calls[0];
			expect(retrievedSmallCall2.chunkCount).to.equal(0);
			expect(retrievedSmallCall2.messages).to.have.lengthOf(3); // system, user, assistant
			expect(retrievedSmallCall2.messages[2].content).to.equal(smallResponse2.messages![2].content); // Check content from messages
		});
	});

	// Add similar tests for getLlmCallsByDescription if needed

	describe('delete', () => {
		it('should delete a single-document LlmCall', async () => {
			// Arrange: Save a small call
			const request: CreateLlmRequest = {
				messages: [user('delete me')],
				description: 'delete test',
				llmId: 'delete-llm',
				userId: testUser.id, // Explicitly set userId
			};
			const savedRequest = await service.saveRequest(request);
			const responseMessages = [...request.messages!, { role: 'assistant', content: 'deleted response' }] as LlmMessage[];
			const response: LlmCall = { ...savedRequest, messages: responseMessages };
			await service.saveResponse(response);

			// Act: Delete the call
			await service.delete(savedRequest.id);

			// Assert: getCall returns null
			const retrievedCall = await service.getCall(savedRequest.id);
			expect(retrievedCall).to.be.null;
		});

		it('should delete a chunked LlmCall and its chunks', async () => {
			// Arrange: Save a large (chunked) call
			const largeContentSize = Math.floor(MAX_DOC_SIZE * 0.6);
			const request: CreateLlmRequest = {
				messages: [user(generateLargeString(largeContentSize))],
				description: 'delete chunked test',
				llmId: 'delete-chunked-llm',
				userId: testUser.id, // Explicitly set userId
			};
			const savedRequest = await service.saveRequest(request);
			const responseMessages = [...request.messages!, { role: 'assistant', content: generateLargeString(largeContentSize) }] as LlmMessage[];
			const response: LlmCall = { ...savedRequest, messages: responseMessages };
			await service.saveResponse(response); // This will create chunks

			// Verify chunks exist before delete
			const chunksQueryBefore = firestoreDb().collection('LlmCall').where('llmCallId', '==', savedRequest.id).where('chunkIndex', '>', 0);
			const chunksSnapshotBefore = await chunksQueryBefore.get();
			expect(chunksSnapshotBefore.empty).to.be.false;
			const mainDocSnapBefore = await firestoreDb().doc(`LlmCall/${savedRequest.id}`).get();
			expect(mainDocSnapBefore.exists).to.be.true;

			// Act: Delete the call
			await service.delete(savedRequest.id);

			// Assert: getCall returns null
			const retrievedCall = await service.getCall(savedRequest.id);
			expect(retrievedCall).to.be.null;

			// Assert: Main document is gone
			const mainDocSnapAfter = await firestoreDb().doc(`LlmCall/${savedRequest.id}`).get();
			expect(mainDocSnapAfter.exists).to.be.false;

			// Assert: Chunk documents are gone
			const chunksSnapshotAfter = await chunksQueryBefore.get(); // Re-run the same query
			expect(chunksSnapshotAfter.empty).to.be.true;
		});

		it('should not throw an error when deleting a non-existent ID', async () => {
			// Act & Assert: Attempt to delete an ID that doesn't exist
			await expect(service.delete('non-existent-id-for-delete')).to.not.be.rejected;
		});
	});
});
