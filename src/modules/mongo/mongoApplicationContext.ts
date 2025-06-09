import { type Db, MongoClient } from 'mongodb';
import type { ApplicationContext } from '#app/applicationTypes';

// Service Interface Imports
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import type { FunctionCacheService } from '#cache/functionCacheService';
import type { ChatService } from '#chat/chatService';
import type { CodeTaskRepository } from '#codeTask/codeTaskRepository';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import type { PromptsService } from '#prompts/promptsService';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';
import type { UserService } from '#user/userService';

// Mongo Service Implementation Imports (Placeholders for files to be created in src/modules/mongo/)
import { MongoAgentContextService } from '#mongo/MongoAgentContextService'; // Placeholder: File src/modules/mongo/MongoAgentContextService.ts will be created later
import { MongoChatService } from '#mongo/MongoChatService'; // Placeholder: File src/modules/mongo/MongoChatService.ts will be created later
import { MongoCodeReviewService } from '#mongo/MongoCodeReviewService'; // Placeholder: File src/modules/mongo/MongoCodeReviewService.ts will be created later
import { MongoCodeTaskRepository } from '#mongo/MongoCodeTaskRepository'; // Placeholder: File src/modules/mongo/MongoCodeTaskRepository.ts will be created later
import { MongoFunctionCacheService } from '#mongo/MongoFunctionCacheService'; // Placeholder: File src/modules/mongo/MongoFunctionCacheService.ts will be created later
import { MongoLlmCallService } from '#mongo/MongoLlmCallService'; // Placeholder: File src/modules/mongo/MongoLlmCallService.ts will be created later
import { MongoPromptsService } from '#mongo/MongoPromptsService';
import { MongoUserService } from '#mongo/MongoUserService';

// Database connection management
let dbInstance: Db | null = null;
const mongoClient = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017');

async function getDb(): Promise<Db> {
	if (dbInstance) {
		return dbInstance;
	}
	// Check if the client is already connected or connecting
	// The specifics might vary slightly based on driver version, but isConnected() is common
	// For modern drivers, you might not need to check isConnected before connect() as connect() is idempotent.
	// However, checking avoids unnecessary calls if already connected.
	// A more robust check might involve looking at `mongoClient.topology.s.state` if available and needed.
	// MongoClient.connect() is idempotent and will no-op if already connected.
	await mongoClient.connect();
	dbInstance = mongoClient.db(process.env.MONGO_DB_NAME || 'typedai-dev');
	return dbInstance;
}

export async function mongoApplicationContext(): Promise<ApplicationContext> {
	const db = await getDb();
	return {
		agentStateService: new MongoAgentContextService(db, mongoClient),
		userService: new MongoUserService(db),
		chatService: new MongoChatService(db),
		llmCallService: new MongoLlmCallService(db),
		functionCacheService: new MongoFunctionCacheService(db),
		codeReviewService: new MongoCodeReviewService(db),
		codeTaskRepository: new MongoCodeTaskRepository(db),
		promptsService: new MongoPromptsService(db, mongoClient),
	};
}

// Optional: Add a function to close the MongoDB connection when the application shuts down
export async function closeMongoConnection(): Promise<void> {
	// mongoClient.close() is safe to call even if the client is already closed or not connected.
	await mongoClient.close();
	dbInstance = null;
}
