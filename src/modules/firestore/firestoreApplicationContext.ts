import type { ApplicationContext } from '#app/applicationTypes';
import { FirestoreAgentStateService } from '#firestore/firestoreAgentStateService';
import { FirestoreChatService } from '#firestore/firestoreChatService';
import { FirestoreCodeReviewService } from '#firestore/firestoreCodeReviewService';
import { FirestoreCacheService } from '#firestore/firestoreFunctionCacheService';
import { FirestoreLlmCallService } from '#firestore/firestoreLlmCallService';
import { FirestoreUserService } from '#firestore/firestoreUserService';
import { FirestoreVibeRepository } from '#firestore/firestoreVibeRepository';
import { FirebasePromptService } from '../../prompts/firebasePromptService';
import type { PromptsService } from '../../prompts/promptService';

export function firestoreApplicationContext(): ApplicationContext {
	return {
		agentStateService: new FirestoreAgentStateService(),
		chatService: new FirestoreChatService(),
		userService: new FirestoreUserService(),
		llmCallService: new FirestoreLlmCallService(),
		functionCacheService: new FirestoreCacheService(),
		codeReviewService: new FirestoreCodeReviewService(),
		promptsService: new FirebasePromptService(),
		vibeRepository: new FirestoreVibeRepository(), // For Vibe we store the Repository
	};
}
