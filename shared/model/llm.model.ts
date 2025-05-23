// https://github.com/AgentOps-AI/tokencost/blob/main/tokencost/model_prices.json
import type {
	FilePart as AiFilePart, // Renamed to avoid conflict if we define our own FilePart
	ImagePart as AiImagePart, // Renamed
	AssistantContent,
	CoreMessage,
	ToolCallPart as ModelToolCallPart, // Corrected import: ModelToolCallPart is an alias for ToolCallPart
	TextPart,
	TextStreamPart,
	ToolContent,
	UserContent,
	// ReasoningPart and RedactedReasoningPart are not exported from 'ai'.
	// We will define them locally below.
} from 'ai';
export type { AssistantContent } from 'ai'; // Re-export AssistantContent
import { ChangePropertyType } from '../typeUtils';

// Local definitions for unexported types from 'ai'
export interface ReasoningPart {
	type: 'reasoning';
	text: string;
	providerMetadata?: Record<string, unknown>;
}

export interface RedactedReasoningPart {
	type: 'redacted-reasoning';
	data: string; // Added data field as indicated by compiler errors
	providerMetadata?: Record<string, unknown>;
}

// Should match fields in CallSettings in node_modules/ai/dist/index.d.ts
export interface CallSettings {
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

	maxOutputTokens?: number;
}

export interface GenerateTextOptions extends CallSettings {
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
	data: DataContent | URL;
	// Mime type of the file.
	mimeType: string;
}
*/

/** Additional information added to the FilePart and ImagePart objects */
export interface AttachmentInfo {
	filename?: string | undefined;
	size?: number | undefined;
	/**
	 * URL to large attachment data stored external from the LlmMessage (ie. in the agent's persistent directory).
	 * When this is set the image/file data will be set to an empty string when saving to the database.
	 */
	externalURL?: string | undefined;
}

// Can't have the node.js Buffer type in the frontend. For now, we will always base64 encode file and image data to keep the typing simple.
// Define UI types to match schema expectations (string data fields)
export interface ImagePartUI {
	type: 'image';
	image: string; // Base64 string or URL
	mimeType?: string;
}

export interface FilePartUI {
	type: 'file';
	data: string; // Base64 string or URL
	mimeType: string;
}

interface TextPartUI {
	type: 'text';
	/** The text content */
	text: string;
}

export type TextPartExt = TextPartUI & { providerOptions?: Record<string, any> };
export type ImagePartExt = ImagePartUI & AttachmentInfo & { providerOptions?: Record<string, any> | undefined };
export type FilePartExt = FilePartUI & AttachmentInfo & { providerOptions?: Record<string, any> | undefined };
export type ToolCallPartExt = ModelToolCallPart;

export type CoreContent = AssistantContent | UserContent | ToolContent;
/** Extension of the 'ai' package UserContent type, using our extended parts */
export type UserContentExt = string | Array<TextPartExt | ImagePartExt | FilePartExt>;
/** Extension for AssistantContent, using our extended parts */
export type AssistantContentExt = string | Array<TextPartExt | ImagePartExt | FilePartExt | ToolCallPartExt | ReasoningPart | RedactedReasoningPart>;

export interface GenerationStats {
	requestTime: number;
	timeToFirstToken: number;
	totalTime: number;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens?: number | undefined;
	cost: number | null;
	llmId: string;
}

// Base properties common to all LlmMessage variants
interface LlmMessageBase {
	/** @deprecated The LLM which generated the text (only when role=assistant) */
	llmId?: string | undefined;
	/** Set the cache_control flag with Claude models */
	cache?: 'ephemeral' | undefined;
	/** @deprecated Time the message was sent */
	time?: number | undefined;
	/** Stats on message generation (i.e when role=assistant) */
	stats?: GenerationStats | undefined;
	/** Provider-specific options for the message. */
	providerOptions?: Record<string, any> | undefined;
}

// Discriminated union for LlmMessage
export type LlmMessage =
	| ({ role: 'system'; content: string } & LlmMessageBase)
	| ({ role: 'user'; content: UserContentExt } & LlmMessageBase)
	| ({ role: 'assistant'; content: AssistantContentExt } & LlmMessageBase)
	| ({ role: 'tool'; content: ToolContent } & LlmMessageBase); // ToolContent from 'ai'

export type SystemUserPrompt = [systemPrompt: string, userPrompt: string];

export type Prompt = string | SystemUserPrompt | LlmMessage[] | ReadonlyArray<LlmMessage>;

export function isSystemUserPrompt(prompt: Prompt): prompt is SystemUserPrompt {
	return Array.isArray(prompt) && prompt.length === 2 && typeof prompt[0] === 'string' && typeof prompt[1] === 'string';
}

/**
 * @param messages
 * @return the last message contents as a string
 */
export function lastText(messages: LlmMessage[] | ReadonlyArray<LlmMessage>): string {
	return messageText(messages.at(-1));
}

/**
 * Transform a LLM message to a string where the content part(s) are string types
 * @param message
 */
export function messageText(message: LlmMessage): string {
	// Cast to CoreContent as any to bypass strict type checking for FilePartExt vs. ai's FilePart.
	// contentText is only concerned with text-producing parts, so structural differences in image/file parts
	// (which it ignores for text extraction) shouldn't affect its logic.
	return contentText(message.content as any);
}

/**
 * @param message
 * @returns if a message contents is text only, then returns the text, else returns null;
 */
export function messageContentIfTextOnly(message: LlmMessage): string | null {
	let text = '';
	if (typeof message.content === 'string') return message.content;

	for (const part of message.content) {
		const type = part.type;
		if (part.type === 'image' || part.type === 'file') return null;
		if (type === 'text') text += part.text;
		else if (type === 'reasoning') text += `${(part as ReasoningPart).text}\n`;
		else if (type === 'redacted-reasoning') text += '<redacted-reasoning>\n';
		else if (type === 'tool-call') text += `Tool Call (${part.toolCallId} ${part.toolName} Args:${JSON.stringify(part.args)})`;
	}
	return text;
}

/**
 * Transform UserContent to a string where the part(s) are string types
 * @param content
 */
export function contentText(content: CoreContent): string {
	if (typeof content === 'string') return content;

	let text = '';
	for (const part of content) {
		const type = part.type;
		if (type === 'text') text += part.text;
		else if (type === 'reasoning') text += `${(part as ReasoningPart).text}\n`;
		else if (type === 'redacted-reasoning') text += '<redacted-reasoning>\n';
		else if (type === 'tool-call')
			text += `Tool Call (${(part as ModelToolCallPart).toolCallId} ${(part as ModelToolCallPart).toolName} Args:${JSON.stringify((part as ModelToolCallPart).args)})`;
		// Note: ImagePart and FilePart do not contribute to text content in this function
	}
	return text;
}

export function extractAttachments(content: UserContentExt): Array<ImagePartExt | FilePartExt | TextPart> {
	return typeof content === 'string' ? [] : content.filter((part) => part.type === 'image' || part.type === 'file');
}

export function text(text: string): TextPart {
	return { type: 'text', text };
}

export function system(text: string, cache = false): LlmMessage {
	return {
		role: 'system',
		content: text,
		cache: cache ? 'ephemeral' : undefined,
	};
}

export function user(content: UserContentExt, cache = false): LlmMessage {
	return {
		role: 'user',
		content,
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

export interface GenerateTextWithJsonResponse<T> {
	/** The generated message */
	message: LlmMessage;
	/** The part of the response before the JSON */
	reasoning: string;
	/** The JSON object */
	object: T;
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
	generateTextWithJson<T>(userPrompt: string, opts?: GenerateJsonOptions): Promise<GenerateTextWithJsonResponse<T>>;
	generateTextWithJson<T>(systemPrompt: string, userPrompt: string, opts?: GenerateJsonOptions): Promise<GenerateTextWithJsonResponse<T>>;
	generateTextWithJson<T>(messages: LlmMessage[] | ReadonlyArray<LlmMessage>, opts?: GenerateJsonOptions): Promise<GenerateTextWithJsonResponse<T>>;

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

	/** Generate a LlmMessage response */
	generateMessage(prompt: string | SystemUserPrompt | ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage>;

	/**
	 * Streams text from the LLM
	 * @param messages
	 * @param onChunk streaming chunk callback
	 * @param opts
	 */
	streamText(
		messages: LlmMessage[] | ReadonlyArray<LlmMessage>,
		onChunk: (chunk: TextStreamPart<any>) => void,
		opts?: GenerateTextOptions,
	): Promise<GenerationStats>;

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

// Re-export TextPart for external use
export type { TextPart };
