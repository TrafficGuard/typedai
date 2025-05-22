import { runLlmCallServiceTests } from '#llm/llmCallService/llmCallService.test';
import {InMemoryLlmCallService} from "#modules/memory/inMemoryLlmCallService";

describe('InMemoryLlmCallService', () => {
	runLlmCallServiceTests(
		() =>  new InMemoryLlmCallService(),
		() => {},
	);
});
