import { runChatServiceTests } from '#chat/chatService.test';
import { InMemoryChatService } from '#modules/memory/inMemoryChatService';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('InMemoryChatService', () => {
	setupConditionalLoggerOutput();
	runChatServiceTests(
		() => new InMemoryChatService(),
		() => {},
	);
});
