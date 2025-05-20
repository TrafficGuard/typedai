import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { runUserServiceTests } from '#user/userService.test';
import { FirestoreUserService } from './firestoreUserService';

describe('FirestoreUserService', () => {
	runUserServiceTests(() => new FirestoreUserService(), resetFirestoreEmulator);
});
