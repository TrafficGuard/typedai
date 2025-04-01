import axios from 'axios';
import { expect } from 'chai';
import sinon from 'sinon';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { system, user } from '#llm/llm';
import { CreateLlmRequest, LlmCall } from '#llm/llmCallService/llmCall';
import { LlmCallService } from '#llm/llmCallService/llmCallService';
import { FirestoreLlmCallService } from '#modules/firestore/firestoreLlmCallService';
import { logger } from '#o11y/logger';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

// https://cloud.google.com/datastore/docs/emulator#reset_emulator_data
const instance = axios.create({
	baseURL: `http://${emulatorHost}/`,
});

// TODO test saving fields longer than 1500 chars
// https://groups.google.com/g/google-appengine/c/hjvWMM9ijkw
describe('FirestoreLlmCallService', () => {
	let service: LlmCallService;

	beforeEach(async () => {
		service = new FirestoreLlmCallService();
		await resetFirestoreEmulator();
	});

	describe('saveRequest and getCall', () => {
		it('should save a request and retrieve it', async () => {
			const request: CreateLlmRequest = {
				messages: [system('Test system prompt'), user('Test user prompt')],
				description: 'Test description',
				llmId: 'test-llm',
				agentId: 'test-agent',
				callStack: 'test > call > stack',
			};

			const savedRequest = await service.saveRequest(request);
			expect(savedRequest).to.have.property('id');
			expect(savedRequest).to.have.property('requestTime');

			const retrievedCall = await service.getCall(savedRequest.id);
			expect(retrievedCall).to.not.be.null;
			expect(retrievedCall.messages[0].role).to.equal(request.messages[0].role);
			expect(retrievedCall.messages[0].content).to.equal(request.messages[0].content);
			expect(retrievedCall.messages[1].role).to.equal(request.messages[1].role);
			expect(retrievedCall.messages[1].content).to.equal(request.messages[1].content);
			expect(retrievedCall.description).to.equal(request.description);
			expect(retrievedCall.llmId).to.equal(request.llmId);
			expect(retrievedCall.agentId).to.equal(request.agentId);
			expect(retrievedCall.callStack).to.equal(request.callStack);
		});
	});

	describe('saveResponse', () => {
		it('should save a response and retrieve it', async () => {
			const request: CreateLlmRequest = {
				messages: [system('Test system prompt'), user('Test user prompt')],
				description: 'Test description',
				llmId: 'test-llm',
				agentId: 'test-agent',
				callStack: 'test > call > stack',
			};

			const savedRequest = await service.saveRequest(request);

			const response: LlmCall = {
				...savedRequest,
				responseText: 'Test response',
				cost: 0.1,
				timeToFirstToken: 100,
				totalTime: 500,
			};

			await service.saveResponse(response);

			const retrievedCall = await service.getCall(savedRequest.id);
			expect(retrievedCall).to.not.be.null;
			expect(retrievedCall.id).to.equal(response.id);
			expect(retrievedCall.messages[0].role).to.equal(response.messages[0].role);
			expect(retrievedCall.messages[0].content).to.equal(response.messages[0].content);
			expect(retrievedCall.messages[1].role).to.equal(response.messages[1].role);
			expect(retrievedCall.messages[1].content).to.equal(response.messages[1].content);
			expect(retrievedCall.description).to.equal(response.description);
			expect(retrievedCall.llmId).to.equal(response.llmId);
			expect(retrievedCall.agentId).to.equal(request.agentId);
			expect(retrievedCall.callStack).to.equal(response.callStack);
			expect(retrievedCall.responseText).to.equal(response.responseText);
			expect(retrievedCall.cost).to.equal(response.cost);
			expect(retrievedCall.timeToFirstToken).to.equal(response.timeToFirstToken);
			expect(retrievedCall.totalTime).to.equal(response.totalTime);
		});
	});

	describe('getLlmCallsForAgent', () => {
		it('should load all the responses for an agent', async () => {
			const agentId = 'test-agent';
			const requests: CreateLlmRequest[] = [
				{
					agentId,
					messages: [system('Test system prompt'), user('Test user prompt')],
					description: 'Test description 1',
					llmId: 'test-llm-1',
					callStack: 'test > call > stack',
				},
				{
					agentId,
					messages: [system('Test system prompt'), user('Test user prompt')],
					description: 'Test description 2',
					llmId: 'test-llm-2',
					callStack: 'test > call > stack',
				},
			];

			for (const request of requests) {
				const savedRequest = await service.saveRequest(request);
				await service.saveResponse({
					...savedRequest,
					responseText: `Response for ${request.messages[0]}`,
					cost: 0.1,
					timeToFirstToken: 100,
					totalTime: 500,
				});
			}

			const calls = await service.getLlmCallsForAgent(agentId);
			expect(calls).to.have.lengthOf(2);
			calls.forEach((call) => {
				expect(call).to.have.property('agentId');
				expect(call).to.have.property('id');
				expect(call).to.have.property('messages');
				expect(call).to.have.property('description');
				expect(call).to.have.property('llmId');
				expect(call).to.have.property('callStack');
				expect(call).to.have.property('responseText');
				expect(call).to.have.property('cost');
				expect(call).to.have.property('timeToFirstToken');
				expect(call).to.have.property('totalTime');
				expect(call).to.have.property('requestTime');
			});
			expect(calls[0].requestTime).to.be.greaterThan(calls[1].requestTime);
		});
	});
});
