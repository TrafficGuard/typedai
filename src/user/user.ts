export interface LLMServicesConfig {
	vertexProjectId?: string;
	vertexRegion?: string;

	anthropicKey?: string;
	cerebrasKey?: string;
	deepinfraKey?: string;
	deepseekKey?: string;
	fireworksKey?: string;
	geminiKey?: string;
	groqKey?: string;
	nebiusKey?: string;
	openaiKey?: string;
	openrouterKey?: string;
	sambanovaKey?: string;
	togetheraiKey?: string;
	xaiKey?: string;
}

export interface ChatSettings {
	/** Which LLMs to display in the chat selector. If an LLM doesn't have an entry then it will be displayed */
	enabledLLMs?: Record<string, boolean>;

	/** Id of the LLM to default to in the AI Chat */
	defaultLLM?: string;
	/**
	 * The default value is passed through to the provider. The range depends on the provider and model. For most providers, 0 means almost deterministic results, and higher values mean more randomness.
	 * It is recommended to set either temperature or topP, but not both.
	 */
	temperature?: number;

	/** Controls diversity via nucleus sampling. Value between 0 and 1. */
	topP?: number;

	/**  */
	topK?: number;

	/** Penalize new tokens based on whether they appear in the text so far */
	presencePenalty?: number;

	/** Penalize new tokens based on their frequency in the text so far */
	frequencyPenalty?: number;
}

export interface User {
	id: string;
	email: string;
	enabled: boolean;
	passwordHash?: string; // Stored hash, not exposed to frontend
	createdAt: Date;
	lastLoginAt?: Date;

	hilBudget: number;
	hilCount: number;

	llmConfig: LLMServicesConfig;

	chat: ChatSettings;

	/** Configuration for the function callable integrations */
	functionConfig: Record<string, Record<string, any>>;
}
