import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { runUserServiceTests } from '#user/userService.test';
import { FirestoreUserService } from './firestoreUserService';

describe('FirestoreUserService', () => {
	setupConditionalLoggerOutput();
	runUserServiceTests(() => new FirestoreUserService(), resetFirestoreEmulator);
});
