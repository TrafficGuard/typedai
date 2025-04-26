import { FirestoreAgentStateService } from '#firestore/firestoreAgentStateService';
import { FirestoreChatService } from '#firestore/firestoreChatService';
import { FirestoreCodeReviewService } from '#firestore/firestoreCodeReviewService';
import { FirestoreCacheService } from '#firestore/firestoreFunctionCacheService';
import { FirestoreLlmCallService } from '#firestore/firestoreLlmCallService';
import { FirestoreUserService } from '#firestore/firestoreUserService';
import { ScmService } from '#functions/scm/scmService';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { FirestoreVibeService } from '#modules/firestore/firestoreVibeService';
import type { ApplicationContext } from '../../applicationTypes';

export function firestoreApplicationContext(): ApplicationContext {
	return {
		agentStateService: new FirestoreAgentStateService(),
		chatService: new FirestoreChatService(),
		userService: new FirestoreUserService(),
		llmCallService: new FirestoreLlmCallService(),
		functionCacheService: new FirestoreCacheService(),
		codeReviewService: new FirestoreCodeReviewService(),
		vibeService: new FirestoreVibeService(),
		scmService: new ScmService(),
		fileSystemService: new FileSystemService(),
		fileSystemList: new FileSystemList(),
	};
}
