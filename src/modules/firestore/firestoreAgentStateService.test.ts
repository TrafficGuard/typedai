import { runAgentStateServiceTests } from '#agent/agentStateService/agentStateService.test';
import { FirestoreAgentStateService } from '#firestore/firestoreAgentStateService';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';

describe('FirestoreAgentStateService', () => {
	runAgentStateServiceTests(() => new FirestoreAgentStateService(), resetFirestoreEmulator);
});
