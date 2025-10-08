import { runChatServiceTests } from '#chat/chatService.test';
import { FirestoreChatService } from '#firestore/firestoreChatService';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('FirestoreChatService', () => {
	setupConditionalLoggerOutput();
	runChatServiceTests(() => new FirestoreChatService(), resetFirestoreEmulator);

	// DO NOT add tests here. All tests must be in the shared ChatService test suite in chatService.test.ts
});
