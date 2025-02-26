// https://github.com/AgentOps-AI/tokencost/blob/main/tokencost/model_prices.json
import { CoreMessage, FilePart, ImagePart, StreamTextResult, TextPart, UserContent } from 'ai';

// Should match fields in CallSettings in node_modules/ai/dist/index.d.ts
export interface GenerateOptions {
	/**
	 * Temperature controls the randomness in token selection. Valid values are between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.
	 * We generally recommend altering this or top_p but not both.
	 */
	temperature?: number;
	/**
	 * Top-p changes how the model selects tokens for output. Tokens are selected from most probable to least until the sum of their probabilities equals the top-p value. For example, if tokens A, B, and C have a probability of .3, .2, and .1 and the top-p value is .5, then the model will select either A or B as the next token (using temperature).
	 */
	topP?: number;

	/**
	 Only sample from the top K options for each subsequent token.

	 Used to remove "long tail" low probability responses.
	 Recommended for advanced use cases only. You usually only need to use temperature.
	 */
	topK?: number;
	/**
	 Presence penalty setting. It affects the likelihood of the model to
	 repeat information that is already in the prompt.

	 The presence penalty is a number between -1 (increase repetition)
	 and 1 (maximum penalty, decrease repetition). 0 means no penalty.
	 */
	presencePenalty?: number;
	/**
	 Frequency penalty setting. It affects the likelihood of the model
	 to repeatedly use the same words or phrases.

	 The frequency penalty is a number between -1 (increase repetition)
	 and 1 (maximum penalty, decrease repetition). 0 means no penalty.
	 */
	frequencyPenalty?: number;
	/**
	 Stop sequences.
	 If set, the model will stop generating text when one of the stop sequences is generated.
	 Providers may have limits on the number of stop sequences.
	 */
	stopSequences?: string[];

	maxRetries?: number;
}

export interface GenerateTextOptions extends GenerateOptions {
	type?: 'text' | 'json';
	/** Identifier used in trace spans, UI etc */
	id?: string;
	thinking?: 'low' | 'medium' | 'high'; // For openai o series and Claude Sonnet 3.7
}

/**
 * Options when generating text expecting JSON
 */
export type GenerateJsonOptions = Omit<GenerateTextOptions, 'type'>;

/*
Types from the 'ai' package:

type CoreMessage = CoreSystemMessage | CoreUserMessage | CoreAssistantMessage | CoreToolMessage;

type CoreUserMessage = {
    role: 'user';
    content: UserContent;
}

type UserContent = string | Array<TextPart | ImagePart | FilePart>;

type DataContent = string | Uint8Array | ArrayBuffer | Buffer;

interface TextPart {
    type: 'text';
    // The text content.
	text: string;
}

interface ImagePart {
    type: 'image';
    // Image data. Can either be:
  	// - data: a base64-encoded string, a Uint8Array, an ArrayBuffer, or a Buffer
  	// - URL: a URL that points to the image
	image: DataContent | URL;
	// Optional mime type of the image.
	mimeType?: string;
}

interface FilePart {
    type: 'file';
    // File data. Can either be:
  	// - data: a base64-encoded string, a Uint8Array, an ArrayBuffer, or a Buffer
  	// - URL: a URL that points to the image
	image: DataContent | URL;
	// Mime type of the file.
	mimeType: string;
}
*/

/** Additional information added to the FilePart and ImagePart objects */
export interface AttachmentInfo {
	filename: string;
	size: number;
}

export type FilePartExt = FilePart & AttachmentInfo;
export type ImagePartExt = ImagePart & AttachmentInfo;

/** Extension of the 'ai' package UserContent type */
export type UserContentExt = string | Array<TextPart | ImagePartExt | FilePartExt>;

export type LlmMessage = CoreMessage & {
	/** The LLM which generated the text (only when role=assistant) */
	llmId?: string;
	/** Set the cache_control flag with Claude models */
	cache?: 'ephemeral';
	/** Time the message was sent */
	time?: number;
};

export function userContentText(userContent: UserContent | any): string {
	return typeof userContent === 'string' ? userContent : userContent.find((content) => content.type === 'text')?.text;
}

export function system(text: string, cache = false): LlmMessage {
	return {
		role: 'system',
		content: text,
		cache: cache ? 'ephemeral' : undefined,
	};
}

export function user(text: string, cache = false): LlmMessage {
	return {
		role: 'user',
		content: text,
		cache: cache ? 'ephemeral' : undefined,
	};
}

/**
 * Prefill the assistant message to help guide its response
 * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prefill-claudes-response
 * @param text
 */
export function assistant(text: string): LlmMessage {
	return {
		role: 'assistant',
		content: text,
	};
}

export interface LLM {
	/** Generates text from a LLM */
	generateText(userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateText(systemPrompt: string, userPrompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateText(messages: LlmMessage[] | ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string>;

	/**
	 * Generates a response that ends with a JSON object wrapped in either <json></json> tags or Markdown triple ticks.
	 * This allows the LLM to generate reasoning etc before the JSON object. However, it's not possible to use structured outputs
	 * which restrict the response to a schema.
	 */
	generateTextWithJson<T>(userPrompt: string, opts?: GenerateJsonOptions): Promise<T>;
	generateTextWithJson<T>(systemPrompt: string, userPrompt: string, opts?: GenerateJsonOptions): Promise<T>;
	generateTextWithJson<T>(messages: LlmMessage[] | ReadonlyArray<LlmMessage>, opts?: GenerateJsonOptions): Promise<T>;

	/** Generates a response which only returns a JSON object. */
	generateJson<T>(userPrompt: string, opts?: GenerateJsonOptions): Promise<T>;
	generateJson<T>(systemPrompt: string, userPrompt: string, opts?: GenerateJsonOptions): Promise<T>;
	generateJson<T>(messages: LlmMessage[] | ReadonlyArray<LlmMessage>, opts?: GenerateJsonOptions): Promise<T>;

	/**
	 * Generates a response that is expected to have a <result></result> element, and returns the text inside it.
	 * This useful when you want to LLM to output discovery, reasoning, etc. to improve the answer, and only want the final result returned.
	 */
	generateTextWithResult(prompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateTextWithResult(systemPrompt: string, prompt: string, opts?: GenerateTextOptions): Promise<string>;
	generateTextWithResult(messages: LlmMessage[] | ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string>;

	/**
	 * Streams text from the LLM
	 * @param messages
	 * @param onChunk streaming chunk callback
	 * @param opts
	 */
	streamText(
		messages: LlmMessage[] | ReadonlyArray<LlmMessage>,
		onChunk: ({ string }) => void,
		opts?: GenerateTextOptions,
	): Promise<StreamTextResult<any, any>>;

	/**
	 * The service provider of the LLM (OpenAI, Google, TogetherAI etc)
	 */
	getService(): string;

	/**
	 * The LLM model identifier. This should match the model ids in the Vercel ai module (https://github.com/vercel/ai)
	 */
	getModel(): string;

	/** UI display name */
	getDisplayName(): string;

	/**
	 * The LLM identifier in the format service:model
	 */
	getId(): string;

	/** The maximum number of input tokens */
	getMaxInputTokens(): number;

	/**
	 * @param text
	 * @returns the number of tokens in the text for this LLM
	 */
	countTokens(text: string): Promise<number>;

	/**
	 * Checks if all necessary configuration variables are set for this LLM.
	 * @returns true if the LLM is properly configured, false otherwise.
	 */
	isConfigured(): boolean;
}

/**
 * The parsed response from an LLM when expecting it to respond with <function_calls></function_calls>
 */
export interface FunctionResponse {
	/** The response from the LMM upto the <function_calls> element */
	textResponse: string;
	/** The parsed <function_calls> element */
	functions: FunctionCalls;
}

export interface FunctionCalls {
	functionCalls: FunctionCall[];
}

export interface FunctionCall {
	/** Iteration of the agent control loop the function was called TODO implement */
	iteration?: number;
	function_name: string; // underscore to match xml element name
	parameters: { [key: string]: any };
}

/**
 * A completed FunctionCall with the output/error.
 */
export interface FunctionCallResult extends FunctionCall {
	stdout?: string;
	stdoutSummary?: string;
	stderr?: string;
	stderrSummary?: string;
}

export function combinePrompts(userPrompt: string, systemPrompt?: string): string {
	systemPrompt = systemPrompt ? `${systemPrompt}\n` : '';
	return `${systemPrompt}${userPrompt}`;
}
