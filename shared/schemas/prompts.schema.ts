import {type Static, Type} from '@sinclair/typebox';
import type {Prompt, PromptPreview} from '../model/prompts.model';
import {GenerateOptionsSchema, LlmMessagesSchema, type LlmMessagesSchemaModel} from './llm.schema';
import type {AreTypesFullyCompatible} from '../utils/type-compatibility';
import type {ChangePropertyType} from '../typeUtils';
import {ApiNullResponseSchema} from './common.schema'; // As per requirement, though not directly used in these schemas

// --- Prompt Options Schema ---
const PromptOptionsSchema = Type.Intersect([
    GenerateOptionsSchema,
    Type.Object({
        llmId: Type.Optional(Type.String())
    })
], { $id: 'PromptOptions' });

// --- Prompt Schema ---
export const PromptSchema = Type.Object({
    id: Type.String(),
    userId: Type.String(),
    parentId: Type.Optional(Type.String()),
    revisionId: Type.Number(),
    name: Type.String(),
    appId: Type.Optional(Type.String()),
    tags: Type.Array(Type.String()),
    messages: LlmMessagesSchema,
    options: PromptOptionsSchema, // Use the new PromptOptionsSchema
}, { $id: 'Prompt' });

// DO NOT CHANGE THIS PART ----
// LlmMessageSchema doesnt exactly map to LlmMessage, but lets assume it does for now
type PromptHack = ChangePropertyType<Prompt, 'messages', LlmMessagesSchemaModel>;
const _PromptCheck: AreTypesFullyCompatible<PromptHack, Static<typeof PromptSchema>> = true;
// -----

// --- PromptPreview Schema ---
const PromptPreviewProps = ['id', 'userId', 'parentId', 'revisionId', 'name', 'appId', 'tags', 'options'] as const;
export const PromptPreviewSchema = Type.Pick(PromptSchema, PromptPreviewProps, { $id: 'PromptPreview' });

const _PromptPreviewCheck: AreTypesFullyCompatible<PromptPreview, Static<typeof PromptPreviewSchema>> = true;

// --- PromptList Schema ---
export const PromptListSchema = Type.Object({
    prompts: Type.Array(PromptPreviewSchema),
    hasMore: Type.Boolean()
}, { $id: 'PromptList' });

// --- API Specific Schemas ---
export const PromptParamsSchema = Type.Object({
    promptId: Type.String()
}, { $id: 'PromptParams' });

export const PromptCreateSchema = Type.Object({
    name: Type.String(),
    messages: LlmMessagesSchema,
    options: PromptOptionsSchema, // Use the new PromptOptionsSchema
    tags: Type.Optional(Type.Array(Type.String())),
    parentId: Type.Optional(Type.String())
    // appId is usually system-assigned or derived, not part of create payload typically.
    // revisionId is system-assigned.
}, { $id: 'PromptCreate' });

export const PromptUpdateSchema = Type.Partial(Type.Object({
    name: Type.String(),
    messages: LlmMessagesSchema, // Entire messages array is replaced if provided
    options: PromptOptionsSchema, // Use the new PromptOptionsSchema
    tags: Type.Array(Type.String()) // Entire tags array is replaced if provided
    // parentId, revisionId, appId are generally not updatable via a generic update payload.
}), { $id: 'PromptUpdate' });

export const PromptRevisionParamsSchema = Type.Object({
    promptId: Type.String(),
    revisionId: Type.String() // revisionId is string in URL params
}, { $id: 'PromptRevisionParams' });


// --- Static Types ---
export type PromptSchemaModel = Static<typeof PromptSchema>;
export type PromptPreviewSchemaModel = Static<typeof PromptPreviewSchema>;
export type PromptParams = Static<typeof PromptParamsSchema>;
export type PromptCreatePayload = Static<typeof PromptCreateSchema>;
export type PromptUpdatePayload = Static<typeof PromptUpdateSchema>;
export type PromptRevisionParams = Static<typeof PromptRevisionParamsSchema>;
export type PromptListSchemaModel = Static<typeof PromptListSchema>;
