import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { FirebasePromptService } from './firebasePromptService';

describe('FirebasePromptService', () => {
	setupConditionalLoggerOutput();
	runPromptsServiceTests(() => new FirebasePromptService(), resetFirestoreEmulator);
});
