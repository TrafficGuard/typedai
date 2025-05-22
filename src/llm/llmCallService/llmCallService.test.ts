import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { randomUUID } from 'node:crypto';
import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import type { LlmCall } from '#shared/model/llmCall.model';
import type { LlmMessage } from '#shared/model/llm.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { LlmCallService } from './llmCallService';

chai.use(chaiAsPromised);
const { expect } = chai;

// Helper function to create a basic LlmMessage
function createTestLlmMessage(role: 'system' | 'user' | 'assistant' | 'tool', content: string): LlmMessage {
	return {
		role,
		content,
	} as LlmMessage; // Cast to LlmMessage for simplicity in tests
}

// Helper function to create a basic CreateLlmRequest
function createTestCreateLlmRequest(overrides: Partial<CreateLlmRequest> = {}): CreateLlmRequest {
	return {
		description: overrides.description ?? `test-call-${randomUUID()}`,
		messages: overrides.messages ?? [createTestLlmMessage('user', 'Hello LLM')],
		settings: overrides.settings ?? { temperature: 0.7 },
		llmId: overrides.llmId ?? 'test-service:test-model',
		agentId: overrides.agentId,
		userId: overrides.userId,
		callStack: overrides.callStack,
	};
}

// Helper function to create a full LlmCall from a CreateLlmRequest and response data
function createTestLlmCallFromRequest(request: CreateLlmRequest, responseData: Partial<LlmCall> = {}): LlmCall {
	const id = responseData.id ?? randomUUID();
	const requestTime = responseData.requestTime ?? Date.now();

	return {
		...request,
		id,
		requestTime,
		...responseData,
	};
}

export function runLlmCallServiceTests(
	createService: () => Promise<LlmCallService> | LlmCallService,
	beforeEachHook?: () => Promise<void> | void,
	afterEachHook?: () => Promise<void> | void,
): void {
	let service: LlmCallService;

	describe('LlmCallService Shared Tests', () => {
		setupConditionalLoggerOutput();

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

		describe('#saveRequest', () => {
			it('should save a new LLM request and return the LlmCall with ID and requestTime', async () => {
				const createRequestData = createTestCreateLlmRequest({
					description: 'Initial request',
					messages: [createTestLlmMessage('user', 'What is 1+1?')],
					settings: { temperature: 0.1, topP: 0.9 },
					llmId: 'openai:gpt-4',
					agentId: 'agent-123',
					userId: 'user-456',
					callStack: 'Agent > Step',
				});

				const savedCall = await service.saveRequest(createRequestData);

				expect(savedCall).to.exist;
				expect(savedCall.id).to.be.a('string').and.not.empty;
				expect(savedCall.requestTime).to.be.a('number'); // Timestamp
				expect(savedCall.description).to.equal(createRequestData.description);
				expect(savedCall.messages).to.deep.equal(createRequestData.messages);
				expect(savedCall.settings).to.deep.equal(createRequestData.settings);
				expect(savedCall.llmId).to.equal(createRequestData.llmId);
				expect(savedCall.agentId).to.equal(createRequestData.agentId);
				expect(savedCall.userId).to.equal(createRequestData.userId);
				expect(savedCall.callStack).to.equal(createRequestData.callStack);

				// Verify it can be retrieved
				const retrievedCall = await service.getCall(savedCall.id);
				expect(retrievedCall).to.deep.equal(savedCall);
			});

			it('should save a request with minimal fields', async () => {
				const createRequestData = createTestCreateLlmRequest({
					description: 'Minimal request',
					messages: [createTestLlmMessage('user', 'Minimal')],
					settings: {}, // Empty settings
					llmId: 'test:minimal',
					agentId: undefined, // Explicitly undefined
					userId: undefined,
					callStack: undefined,
				});

				const savedCall = await service.saveRequest(createRequestData);

				expect(savedCall).to.exist;
				expect(savedCall.id).to.be.a('string').and.not.empty;
				expect(savedCall.requestTime).to.be.a('number');
				expect(savedCall.description).to.equal(createRequestData.description);
				expect(savedCall.messages).to.deep.equal(createRequestData.messages);
				expect(savedCall.settings).to.deep.equal({}); // Should be saved as empty object
				expect(savedCall.llmId).to.equal(createRequestData.llmId);
				expect(savedCall.agentId).to.be.undefined; // Should be saved as null/undefined
				expect(savedCall.userId).to.be.undefined;
				expect(savedCall.callStack).to.be.undefined;

				const retrievedCall = await service.getCall(savedCall.id);
				// Note: DB might store undefined as null, so deep.equal might fail on optional fields.
				// Check essential fields and then use deep.include or specific checks for optional ones.
				expect(retrievedCall?.id).to.equal(savedCall.id);
				expect(retrievedCall?.description).to.equal(savedCall.description);
				expect(retrievedCall?.messages).to.deep.equal(savedCall.messages);
				expect(retrievedCall?.settings).to.deep.equal(savedCall.settings);
				expect(retrievedCall?.llmId).to.equal(savedCall.llmId);
				expect(retrievedCall?.agentId).to.be.oneOf([undefined, null]); // Accept null or undefined
				expect(retrievedCall?.userId).to.be.oneOf([undefined, null]);
				expect(retrievedCall?.callStack).to.be.oneOf([undefined, null]);
			});
		});

		describe('#saveResponse', () => {
			it('should save (update) an LLM call with response data', async () => {
				const createRequestData = createTestCreateLlmRequest();
				const initialSavedRequest = await service.saveRequest(createRequestData);

				const fullCallData = createTestLlmCallFromRequest(initialSavedRequest, {
					timeToFirstToken: 200,
					totalTime: 1000,
					cost: 0.002,
					inputTokens: 15,
					outputTokens: 25,
					cacheCreationInputTokens: 5,
					cacheReadInputTokens: 3,
					warning: 'Test warning',
					messages: [...initialSavedRequest.messages, createTestLlmMessage('assistant', 'Response text')], // Add assistant message
				});

				await service.saveResponse(fullCallData); // Changed: No assignment to savedCall

				const retrievedCall = await service.getCall(fullCallData.id); // Changed: Fetch after save
				expect(retrievedCall).to.not.be.null;
				expect(retrievedCall!.id).to.equal(initialSavedRequest.id);
				expect(retrievedCall!.requestTime).to.equal(initialSavedRequest.requestTime); // Should remain unchanged

				// Create a comparable object from fullCallData, as retrievedCall might have more/less undefined fields
				// depending on DB schema (e.g. null vs undefined)
				const expectedRetrievedData: Partial<LlmCall> = { ...fullCallData };
				for (const key in expectedRetrievedData) {
					if (expectedRetrievedData[key as keyof LlmCall] === undefined) {
						delete expectedRetrievedData[key as keyof LlmCall];
					}
				}
				// Ensure all defined fields in fullCallData are present and correct in retrievedCall
				expect(retrievedCall).to.deep.include(expectedRetrievedData);

				// Specifically check fields that might be handled differently by implementations
				expect(retrievedCall?.cacheCreationInputTokens).to.equal(fullCallData.cacheCreationInputTokens);
				expect(retrievedCall?.cacheReadInputTokens).to.equal(fullCallData.cacheReadInputTokens);
				expect(retrievedCall?.messages).to.deep.equal(fullCallData.messages); // Check messages were updated
			});

			it('should handle LlmCall with minimal response fields (only messages updated)', async () => {
				const createRequestData = createTestCreateLlmRequest();
				const initialSavedRequest = await service.saveRequest(createRequestData);

				const updatedMessages = [...initialSavedRequest.messages, createTestLlmMessage('assistant', 'Minimal response')];
				const minimalCallData: LlmCall = {
					...initialSavedRequest,
					messages: updatedMessages,
					// All other response fields are left undefined
				};

				await service.saveResponse(minimalCallData); // Changed: No assignment

				const retrievedCall = await service.getCall(minimalCallData.id); // Changed: Fetch after save
				expect(retrievedCall).to.not.be.null;
				expect(retrievedCall!.id).to.equal(initialSavedRequest.id);
				expect(retrievedCall!.messages).to.deep.equal(updatedMessages);
				expect(retrievedCall!.totalTime).to.be.oneOf([undefined, null]); // Check one optional field is not set

				const expectedRetrievedData: Partial<LlmCall> = { ...minimalCallData };
				for (const key in expectedRetrievedData) {
					if (expectedRetrievedData[key as keyof LlmCall] === undefined) {
						delete expectedRetrievedData[key as keyof LlmCall];
					}
				}
				expect(retrievedCall).to.deep.include(expectedRetrievedData);
			});

			it('should update existing response fields if saveResponse is called again', async () => {
				const createRequestData = createTestCreateLlmRequest();
				const initialSavedRequest = await service.saveRequest(createRequestData);
				const firstCallData = createTestLlmCallFromRequest(initialSavedRequest, { totalTime: 500, cost: 0.001, messages: [...initialSavedRequest.messages, createTestLlmMessage('assistant', 'First response')] });
				await service.saveResponse(firstCallData);

				const secondCallData = createTestLlmCallFromRequest(initialSavedRequest, { totalTime: 1500, cost: 0.003, error: 'New Error', messages: [...initialSavedRequest.messages, createTestLlmMessage('assistant', 'Second response')] });
				await service.saveResponse(secondCallData); // Changed: No assignment

				const retrievedCall = await service.getCall(initialSavedRequest.id); // Changed: Fetch after save
				expect(retrievedCall).to.not.be.null;
				expect(retrievedCall!.totalTime).to.equal(1500);
				expect(retrievedCall!.cost).to.equal(0.003);
				expect(retrievedCall!.error).to.equal('New Error');
				expect(retrievedCall!.messages).to.deep.equal(secondCallData.messages); // Check messages were updated

				const expectedRetrievedData: Partial<LlmCall> = { ...secondCallData };
				for (const key in expectedRetrievedData) {
					if (expectedRetrievedData[key as keyof LlmCall] === undefined) {
						delete expectedRetrievedData[key as keyof LlmCall];
					}
				}
				expect(retrievedCall).to.deep.include(expectedRetrievedData);
			});

			it('should throw an error if the LlmCall ID does not exist when saving response', async () => {
				const nonExistentCall = createTestLlmCallFromRequest(createTestCreateLlmRequest(), { id: 'nonexistent-id-for-response' });
				await expect(service.saveResponse(nonExistentCall)).to.be.rejectedWith(Error);
			});
		});

		describe('#getCall', () => {
			it('should retrieve an existing LLM call by ID', async () => {
				const createRequestData = createTestCreateLlmRequest();
				const savedCall = await service.saveRequest(createRequestData);

				const retrievedCall = await service.getCall(savedCall.id);
				expect(retrievedCall).to.deep.equal(savedCall);
			});

			it('should return null if LLM call is not found', async () => {
				const retrievedCall = await service.getCall('nonexistent-call-id');
				expect(retrievedCall).to.be.null;
			});
		});

		describe('#getLlmCallsForAgent', () => {
			it('should retrieve all LLM calls for a specific agent', async () => {
				const agentId = `agent-${randomUUID()}`;
				const userCall = await service.saveRequest(createTestCreateLlmRequest({ userId: 'user-abc' })); // Not for this agent
				const agentCall1 = await service.saveRequest(createTestCreateLlmRequest({ agentId, description: 'Agent Call 1' }));
				const agentCall2 = await service.saveRequest(createTestCreateLlmRequest({ agentId, description: 'Agent Call 2' }));
				const otherAgentCall = await service.saveRequest(createTestCreateLlmRequest({ agentId: 'other-agent', description: 'Other Agent Call' }));

				// Add response data to ensure full LlmCall objects are returned
				await service.saveResponse(createTestLlmCallFromRequest(agentCall1, { totalTime: 100 }));
				await service.saveResponse(createTestLlmCallFromRequest(agentCall2, { totalTime: 200 }));
				await service.saveResponse(createTestLlmCallFromRequest(userCall, { totalTime: 50 }));
				await service.saveResponse(createTestLlmCallFromRequest(otherAgentCall, { totalTime: 150 }));


				const agentCalls = await service.getLlmCallsForAgent(agentId);

				expect(agentCalls).to.be.an('array').with.lengthOf(2);
				// Check if the retrieved calls match the ones saved for this agent
				const retrievedIds = agentCalls.map((call) => call.id);
				expect(retrievedIds).to.include(agentCall1.id);
				expect(retrievedIds).to.include(agentCall2.id);

				// Ensure the full LlmCall objects with response data are returned
				const retrievedCall1 = agentCalls.find(c => c.id === agentCall1.id);
				expect(retrievedCall1?.totalTime).to.equal(100);
				const retrievedCall2 = agentCalls.find(c => c.id === agentCall2.id);
				expect(retrievedCall2?.totalTime).to.equal(200);
			});

			it('should return an empty array if no calls exist for the agent', async () => {
				const agentCalls = await service.getLlmCallsForAgent('nonexistent-agent-id');
				expect(agentCalls).to.be.an('array').that.is.empty;
			});

			it('should apply the limit parameter when retrieving calls for an agent', async () => {
				const agentId = `agent-limit-${randomUUID()}`;
				// Create more calls than the limit
				const calls = [];
				for (let i = 0; i < 5; i++) {
					calls.push(await service.saveRequest(createTestCreateLlmRequest({ agentId, description: `Call ${i}` })));
				}
				// Add response data
				for (const call of calls) {
					await service.saveResponse(createTestLlmCallFromRequest(call, { totalTime: 100 + Math.random() * 100 }));
				}


				const limitedCalls = await service.getLlmCallsForAgent(agentId, 3);

				expect(limitedCalls).to.be.an('array').with.lengthOf(3);
				// The order might depend on the implementation (e.g., by requestTime DESC),
				// so we just check the count and that they belong to the agent.
				limitedCalls.forEach(call => {
					expect(call.agentId).to.equal(agentId);
					expect(call.totalTime).to.be.a('number'); // Ensure response data is present
				});
			});
		});

		describe('#getLlmCallsByDescription', () => {
			it('should retrieve all LLM calls for a specific description', async () => {
				const description = `desc-${randomUUID()}`;
				const call1 = await service.saveRequest(createTestCreateLlmRequest({ description, userId: 'user-a' }));
				const call2 = await service.saveRequest(createTestCreateLlmRequest({ description, userId: 'user-b' }));
				const otherDescCall = await service.saveRequest(createTestCreateLlmRequest({ description: 'other-desc', userId: 'user-a' }));

				// Add response data
				await service.saveResponse(createTestLlmCallFromRequest(call1, { totalTime: 100 }));
				await service.saveResponse(createTestLlmCallFromRequest(call2, { totalTime: 200 }));
				await service.saveResponse(createTestLlmCallFromRequest(otherDescCall, { totalTime: 50 }));

				const descCalls = await service.getLlmCallsByDescription(description);

				expect(descCalls).to.be.an('array').with.lengthOf(2);
				const retrievedIds = descCalls.map((call) => call.id);
				expect(retrievedIds).to.include(call1.id);
				expect(retrievedIds).to.include(call2.id);

				// Ensure the full LlmCall objects with response data are returned
				const retrievedCall1 = descCalls.find(c => c.id === call1.id);
				expect(retrievedCall1?.totalTime).to.equal(100);
				const retrievedCall2 = descCalls.find(c => c.id === call2.id);
				expect(retrievedCall2?.totalTime).to.equal(200);
			});

			it('should return an empty array if no calls exist for the description', async () => {
				const descCalls = await service.getLlmCallsByDescription('nonexistent-description');
				expect(descCalls).to.be.an('array').that.is.empty;
			});

			it('should filter by agentId when provided', async () => {
				const description = `desc-agent-${randomUUID()}`;
				const agentId1 = `agent-${randomUUID()}`;
				const agentId2 = `agent-${randomUUID()}`;

				const call1Agent1 = await service.saveRequest(createTestCreateLlmRequest({ description, agentId: agentId1 }));
				const call2Agent1 = await service.saveRequest(createTestCreateLlmRequest({ description, agentId: agentId1 }));
				const call1Agent2 = await service.saveRequest(createTestCreateLlmRequest({ description, agentId: agentId2 }));
				const otherDescCall = await service.saveRequest(createTestCreateLlmRequest({ description: 'other-desc', agentId: agentId1 }));

				// Add response data
				await service.saveResponse(createTestLlmCallFromRequest(call1Agent1, { totalTime: 100 }));
				await service.saveResponse(createTestLlmCallFromRequest(call2Agent1, { totalTime: 200 }));
				await service.saveResponse(createTestLlmCallFromRequest(call1Agent2, { totalTime: 300 }));
				await service.saveResponse(createTestLlmCallFromRequest(otherDescCall, { totalTime: 50 }));


				const descCallsForAgent1 = await service.getLlmCallsByDescription(description, agentId1);

				expect(descCallsForAgent1).to.be.an('array').with.lengthOf(2);
				const retrievedIds = descCallsForAgent1.map((call) => call.id);
				expect(retrievedIds).to.include(call1Agent1.id);
				expect(retrievedIds).to.include(call2Agent1.id);
				expect(retrievedIds).to.not.include(call1Agent2.id); // Should not include calls from agent2

				descCallsForAgent1.forEach(call => {
					expect(call.agentId).to.equal(agentId1);
					expect(call.totalTime).to.be.a('number'); // Ensure response data is present
				});
			});

			it('should apply the limit parameter when retrieving calls by description', async () => {
				const description = `desc-limit-${randomUUID()}`;
				const userId = `user-${randomUUID()}`;
				// Create more calls than the limit
				const calls = [];
				for (let i = 0; i < 5; i++) {
					calls.push(await service.saveRequest(createTestCreateLlmRequest({ description, userId, requestTime: Date.now() + i }))); // Ensure distinct request times for potential ordering
				}
				// Add response data
				for (const call of calls) {
					await service.saveResponse(createTestLlmCallFromRequest(call, { totalTime: 100 + Math.random() * 100 }));
				}

				const limitedCalls = await service.getLlmCallsByDescription(description, undefined, 3); // No agentId filter

				expect(limitedCalls).to.be.an('array').with.lengthOf(3);
				limitedCalls.forEach(call => {
					expect(call.description).to.equal(description);
					expect(call.totalTime).to.be.a('number'); // Ensure response data is present
				});
			});

			it('should apply both agentId and limit parameters', async () => {
				const description = `desc-agent-limit-${randomUUID()}`;
				const agentId = `agent-${randomUUID()}`;

				// Create calls for the target agent and description
				const targetCalls = [];
				for (let i = 0; i < 5; i++) {
					targetCalls.push(await service.saveRequest(createTestCreateLlmRequest({ description, agentId, requestTime: Date.now() + i })));
				}
				// Create other calls that should be filtered out
				await service.saveRequest(createTestCreateLlmRequest({ description: 'other-desc', agentId }));
				await service.saveRequest(createTestCreateLlmRequest({ description, agentId: 'other-agent' }));

				// Add response data to all calls
				const allCalls = [...targetCalls, await service.getLlmCallsByDescription('other-desc', agentId).then(c => c[0]), await service.getLlmCallsByDescription(description, 'other-agent').then(c => c[0])];
				for (const call of allCalls) {
					if (call) await service.saveResponse(createTestLlmCallFromRequest(call, { totalTime: 100 + Math.random() * 100 }));
				}


				const limitedCalls = await service.getLlmCallsByDescription(description, agentId, 3);

				expect(limitedCalls).to.be.an('array').with.lengthOf(3);
				limitedCalls.forEach(call => {
					expect(call.description).to.equal(description);
					expect(call.agentId).to.equal(agentId);
					expect(call.totalTime).to.be.a('number'); // Ensure response data is present
				});
			});
		});

		describe('#delete', () => {
			it('should delete an existing LLM call', async () => {
				const createRequestData = createTestCreateLlmRequest();
				const savedCall = await service.saveRequest(createRequestData);
				await service.saveResponse(createTestLlmCallFromRequest(savedCall, { totalTime: 100 })); // Add response data

				const retrievedCallBeforeDelete = await service.getCall(savedCall.id);
				expect(retrievedCallBeforeDelete).to.not.be.null;

				await service.delete(savedCall.id);

				const retrievedCallAfterDelete = await service.getCall(savedCall.id);
				expect(retrievedCallAfterDelete).to.be.null;
			});

			it('should not throw an error if the LLM call to delete does not exist', async () => {
				await expect(service.delete('nonexistent-id-to-delete')).to.not.be.rejected;
			});
		});
	});
}
