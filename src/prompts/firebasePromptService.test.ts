import { FirebasePromptService } from './firebasePromptService';
import { resetFirestoreEmulator } from '../modules/firestore/resetFirestoreEmulator';
import { runPromptsServiceTests } from './prompts.test';

describe('FirebasePromptService', () => {
    runPromptsServiceTests(() => new FirebasePromptService(), resetFirestoreEmulator);
});
