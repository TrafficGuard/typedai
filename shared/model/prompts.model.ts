import {CallSettings, LlmMessage} from "#shared/model/llm.model";

/**
 * Prompts make up the users Prompt library, to test, evaluate and refine the LLM prompts.
 */
export interface Prompt {
    id: string;
    /** The owning user */
    userId: string;
    /** The prompt this one was branched from (if any) */
    parentId?: string;
    /** If the user has versioning selected in the UI, then saving should save a new version of this prompt with the revisionId incremented, otherwise it should overwrite the current one.  */
    revisionId: number;
    /** The user provided name for the prompt */
    name: string;
    /** If a prompt was from an agent execution, then this is the id assigned in the code */
    appId?: string;
    /** Tags for categorising and searching */
    tags: string[];
    /** The LLM prompt messages */
    messages: LlmMessage[];
    /** The call settings (temperature, topP etc) to generate the response with, including the default LLM ID */
    settings: CallSettings & { llmId?: string };
}

/**
 * Represents a preview of a Prompt, excluding the detailed messages.
 * Used for listings or summaries where full message content is not needed.
 */
export type PromptPreview = Omit<Prompt, 'messages'>

// Add with other model interfaces
export interface PromptGeneratePayloadModel {
    options?: CallSettings & { llmId?: string };
}

// Add with other model interfaces
export interface PromptGenerateResponseModel {
    generatedMessage: LlmMessage;
}
