import { runChatServiceTests } from '#chat/chatService.test';
import { InMemoryChatService } from '#modules/memory/inMemoryChatService';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('InMemoryChatService', () => {
	setupConditionalLoggerOutput();
	runChatServiceTests(
		() => new InMemoryChatService(),
		() => {},
	);

	// DO NOT add tests here. All tests must be in the shared ChatService test suite in chatService.test.ts
});
