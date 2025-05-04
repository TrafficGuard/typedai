import { runAgentStateServiceTests } from '#agent/agentContextService/agentContextService.test';
import { FirestoreAgentStateService } from '#firestore/firestoreAgentStateService';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';

describe('FirestoreAgentStateService', () => {
	runAgentStateServiceTests(() => new FirestoreAgentStateService(), resetFirestoreEmulator);
});
