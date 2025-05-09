// Types copied from the "ai" npm package so we don't need to install the entire package
// Also the ai types depend on node.js types, which we don't want to include in the frontend project
// filename is added to FilePart and ImagePart

export type AiMessage = CoreSystemMessage | CoreUserMessage | CoreAssistantMessage | CoreToolMessage;

type JSONValue = null | string | number | boolean | JSONObject | JSONArray;
type JSONObject = {
    [key: string]: JSONValue;
};
type JSONArray = JSONValue[];

type LanguageModelV1ProviderMetadata = Record<string, Record<string, JSONValue>>;
type ProviderMetadata = LanguageModelV1ProviderMetadata;

/**
 Data content. Can either be a base64-encoded string, a Uint8Array, an ArrayBuffer.
 Does not have the Buffer union type which exists on the server-side type
 */
type DataContent = string | Uint8Array | ArrayBuffer;

/**
 Text content part of a prompt. It contains a string of text.
 */
export interface TextPart {
    type: 'text';
    /**
     The text content.
     */
    text: string;
}

interface ReasoningPart {
    type: 'reasoning';
    /**
     The reasoning text.
     */
    text: string;
}
/**
 Redacted reasoning content part of a prompt.
 */
interface RedactedReasoningPart {
    type: 'redacted-reasoning';
    /**
     Redacted reasoning data.
     */
    data: string;
}

export type ImagePartExt = ImagePart & {
    /** File name */
    filename: string;
    /** File size in bytes */
    size: number;
}


/**
 Image content part of a prompt. It contains an image.
 */
export interface ImagePart {
    type: 'image';
    /**
     Image data. Can either be:

     - data: a base64-encoded string, a Uint8Array, an ArrayBuffer
     - URL: a URL that points to the image
     */
    image: DataContent | URL;
    /**
     Optional mime type of the image.
     */
    mimeType?: string;
    /** File name */
    filename: string;
}

export type FilePartExt = FilePart & {
    /** File name */
    filename: string;
    /** File size in bytes */
    size: number;
}

/**
 *
 File content part of a prompt. It contains a file.
 */
export interface FilePart {
    type: 'file';
    /**
     File data. Can either be:

     - data: a base64-encoded string, a Uint8Array, an ArrayBuffer, or a Buffer
     - URL: a URL that points to the image
     */
    data: DataContent | URL;
    /**
     Mime type of the file.
     */
    mimeType: string;
    /** File name */
    filename: string;
}

type ToolResultContent = Array<{
    type: 'text';
    text: string;
} | {
    type: 'image';
    data: string;
    mimeType?: string;
}>;
/**
 Tool call content part of a prompt. It contains a tool call (usually generated by the AI model).
 */
export interface ToolCallPart {
    type: 'tool-call';
    /**
     ID of the tool call. This ID is used to match the tool call with the tool result.
     */
    toolCallId: string;
    /**
     Name of the tool that is being called.
     */
    toolName: string;
    /**
     Arguments of the tool call. This is a JSON-serializable object that matches the tool's input schema.
     */
    args: unknown;
    /**
     Additional provider-specific metadata. They are passed through
     to the provider from the AI SDK and enable provider-specific
     functionality that can be fully encapsulated in the provider.
     */
    experimental_providerMetadata?: ProviderMetadata;
}
/**
 Tool result content part of a prompt. It contains the result of the tool call with the matching ID.
 */
interface ToolResultPart {
    type: 'tool-result';
    /**
     ID of the tool call that this result is associated with.
     */
    toolCallId: string;
    /**
     Name of the tool that generated this result.
     */
    toolName: string;
    /**
     Result of the tool call. This is a JSON-serializable object.
     */
    result: unknown;
    /**
     Multi-part content of the tool result. Only for tools that support multipart results.
     */
    experimental_content?: ToolResultContent;
    /**
     Optional flag if the result is an error or an error message.
     */
    isError?: boolean;
    /**
     Additional provider-specific metadata. They are passed through
     to the provider from the AI SDK and enable provider-specific
     functionality that can be fully encapsulated in the provider.
     */
    experimental_providerMetadata?: ProviderMetadata;
}

/**
 A system message. It can contain system information.

 Note: using the "system" part of the prompt is strongly preferred
 to increase the resilience against prompt injection attacks,
 and because not all providers support several system messages.
 */
type CoreSystemMessage = {
    role: 'system';
    content: string;
    /**
     Additional provider-specific metadata. They are passed through
     to the provider from the AI SDK and enable provider-specific
     functionality that can be fully encapsulated in the provider.
     */
    experimental_providerMetadata?: ProviderMetadata;
};
/**
 A user message. It can contain text or a combination of text and images.
 */
type CoreUserMessage = {
    role: 'user';
    content: UserContent;
    /**
     Additional provider-specific metadata. They are passed through
     to the provider from the AI SDK and enable provider-specific
     functionality that can be fully encapsulated in the provider.
     */
    experimental_providerMetadata?: ProviderMetadata;
};
/**
 Content of a user message. It can be a string or an array of text and image parts.
 */
type UserContent = string | Array<TextPart | ImagePart | FilePart>;
/**
 An assistant message. It can contain text, tool calls, or a combination of text and tool calls.
 */
type CoreAssistantMessage = {
    role: 'assistant';
    content: AssistantContent;
    /**
     Additional provider-specific metadata. They are passed through
     to the provider from the AI SDK and enable provider-specific
     functionality that can be fully encapsulated in the provider.
     */
    experimental_providerMetadata?: ProviderMetadata;
};
/**
 Content of an assistant message. It can be a string or an array of text and tool call parts.
 */
type AssistantContent = string | Array<TextPart | ReasoningPart | RedactedReasoningPart| ToolCallPart>;
/**
 A tool message. It contains the result of one or more tool calls.
 */
type CoreToolMessage = {
    role: 'tool';
    content: ToolContent;
    /**
     Additional provider-specific metadata. They are passed through
     to the provider from the AI SDK and enable provider-specific
     functionality that can be fully encapsulated in the provider.
     */
    experimental_providerMetadata?: ProviderMetadata;
};
/**
 Content of a tool message. It is an array of tool result parts.
 */
type ToolContent = Array<ToolResultPart>;


/**
 A message that can be used in the `messages` field of a prompt.
 It can be a user message, an assistant message, or a tool message.
 */
export type CoreMessage = CoreSystemMessage | CoreUserMessage | CoreAssistantMessage | CoreToolMessage;
