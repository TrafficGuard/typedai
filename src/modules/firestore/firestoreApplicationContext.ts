import type { ApplicationContext } from '#app/applicationTypes';
import { FirebasePromptService } from '#firestore/firebasePromptService';
import { FirestoreAgentStateService } from '#firestore/firestoreAgentStateService';
import { FirestoreChatService } from '#firestore/firestoreChatService';
import { FirestoreCodeReviewService } from '#firestore/firestoreCodeReviewService';
import { FirestoreCodeTaskRepository } from '#firestore/firestoreCodeTaskRepository';
import { FirestoreCacheService } from '#firestore/firestoreFunctionCacheService';
import { FirestoreLlmCallService } from '#firestore/firestoreLlmCallService';
import { FirestoreUserService } from '#firestore/firestoreUserService';

export function firestoreApplicationContext(): ApplicationContext {
	return {
		agentStateService: new FirestoreAgentStateService(),
		chatService: new FirestoreChatService(),
		userService: new FirestoreUserService(),
		llmCallService: new FirestoreLlmCallService(),
		functionCacheService: new FirestoreCacheService(),
		codeReviewService: new FirestoreCodeReviewService(),
		promptsService: new FirebasePromptService(),
		codeTaskRepository: new FirestoreCodeTaskRepository(), // For CodeTask we store the Repository
	};
}
