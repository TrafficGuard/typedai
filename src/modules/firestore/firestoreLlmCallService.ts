import { randomUUID } from 'crypto';
import { DocumentSnapshot, Firestore } from '@google-cloud/firestore';
import { CreateLlmRequest, LlmCall, LlmRequest } from '#llm/llmCallService/llmCall';
import { LlmCallService } from '#llm/llmCallService/llmCallService';
import { currentUser } from '#user/userService/userContext';
import { firestoreDb } from './firestore';

// TODO add composite index LlmCall	agentId Ascending requestTime Descending __name__ Descending
/**
 * Implementation of the LlmCallService interface using Google Firestore.
 */
export class FirestoreLlmCallService implements LlmCallService {
	private db: Firestore = firestoreDb();

	private deserialize(id: string, data: any): LlmCall {
		return {
			id: id,
			cost: data.cost,
			userPrompt: data.userPrompt,
			systemPrompt: data.systemPrompt,
			messages: data.messages,
			description: data.description,
			responseText: data.responseText,
			llmId: data.llmId,
			requestTime: data.requestTime,
			timeToFirstToken: data.timeToFirstToken,
			totalTime: data.totalTime,
			agentId: data.agentId,
			userId: data.userId,
			callStack: data.callStack,
			inputTokens: data.inputTokens,
			outputTokens: data.outputTokens,
		};
	}

	/**
	 * Retrieves LlmResponse entities from the Firestore based on the provided agentId.
	 * @param {string} agentId - The agentId to filter the LlmResponse entities.
	 * @returns {Promise<LlmCall[]>} - A promise that resolves to an array of LlmResponse entities.
	 */
	async getLlmCallsForAgent(agentId: string): Promise<LlmCall[]> {
		const querySnapshot = await this.db.collection('LlmCall').where('agentId', '==', agentId).orderBy('requestTime', 'desc').get();
		return querySnapshot.docs.map((doc) => this.deserialize(doc.id, doc.data()));
	}

	async saveRequest(request: CreateLlmRequest): Promise<LlmRequest> {
		const id: string = randomUUID();
		const llmResponseDocRef = this.db.doc(`LlmCall/${id}`);
		const requestTime = Date.now();
		await llmResponseDocRef.set({ ...request, requestTime });
		return { id, ...request, requestTime };
	}

	async saveResponse(llmCall: LlmCall): Promise<void> {
		const messages = llmCall.messages;
		// If we've pre-filled the assistant response, then remove that message
		if (messages.at(-1).role === 'assistant') {
			messages.pop();
		}
		messages.push({ role: 'assistant', content: llmCall.responseText });
		llmCall.responseText = undefined;

		const llmResponseDocRef = this.db.doc(`LlmCall/${llmCall.id}`);
		await llmResponseDocRef.set(llmCall);
	}

	async getCall(llmCallId: string): Promise<LlmCall | null> {
		const docRef = this.db.doc(`LlmCall/${llmCallId}`);
		const docSnap: DocumentSnapshot = await docRef.get();
		if (!docSnap.exists) {
			return null;
		}
		return this.deserialize(docSnap.id, docSnap.data());
	}

	async getLlmCallsByDescription(description: string): Promise<LlmCall[]> {
		const querySnapshot = await this.db
			.collection('LlmCall')
			.where('userId', '==', currentUser().id)
			.where('description', '==', description)
			.orderBy('requestTime', 'desc')
			.get();
		return querySnapshot.docs.map((doc) => this.deserialize(doc.id, doc.data()));
	}
}
