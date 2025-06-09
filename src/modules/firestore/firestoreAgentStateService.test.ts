import { runAgentStateServiceTests } from '#agent/agentContextService/agentContextService.test';
import { FirestoreAgentStateService } from '#firestore/firestoreAgentStateService';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('FirestoreAgentStateService', () => {
	setupConditionalLoggerOutput();
	runAgentStateServiceTests(() => new FirestoreAgentStateService(), resetFirestoreEmulator);
});
