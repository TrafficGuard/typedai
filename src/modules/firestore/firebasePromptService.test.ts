import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { FirebasePromptService } from './firebasePromptService';

describe('FirebasePromptService', () => {
	runPromptsServiceTests(() => new FirebasePromptService(), resetFirestoreEmulator);
});
