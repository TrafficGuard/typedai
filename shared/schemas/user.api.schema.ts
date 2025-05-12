import { Type, type Static } from '@sinclair/typebox';
// Source of Truth Model Interfaces
import type {
    User,
    ChatSettings,
    LLMServicesConfig,
    UserProfile,
    UpdateUserProfilePayload,
    UpdateUserProfilePayloadProps,
} from '#shared/model/user.model';
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';


export const ChatSettingsApiSchema = Type.Object({
    enabledLLMs: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
    defaultLLM: Type.Optional(Type.String()),
    temperature: Type.Optional(Type.Number()), // Add min/max if defined in model or desired
    topP: Type.Optional(Type.Number()),
    topK: Type.Optional(Type.Number()),
    presencePenalty: Type.Optional(Type.Number()),
    frequencyPenalty: Type.Optional(Type.Number()),
});
const _chatSettingsApiCheck: AreTypesFullyCompatible<ChatSettings, Static<typeof ChatSettingsApiSchema>> = true;


export const LLMServicesConfigApiSchema = Type.Object({
    vertexProjectId: Type.Optional(Type.String()),
    vertexRegion: Type.Optional(Type.String()),
    anthropicKey: Type.Optional(Type.String()),
    cerebrasKey: Type.Optional(Type.String()),
    deepinfraKey: Type.Optional(Type.String()),
    deepseekKey: Type.Optional(Type.String()),
    fireworksKey: Type.Optional(Type.String()),
    geminiKey: Type.Optional(Type.String()),
    groqKey: Type.Optional(Type.String()),
    nebiusKey: Type.Optional(Type.String()),
    openaiKey: Type.Optional(Type.String()),
    openrouterKey: Type.Optional(Type.String()),
    sambanovaKey: Type.Optional(Type.String()),
    togetheraiKey: Type.Optional(Type.String()),
    xaiKey: Type.Optional(Type.String()),
});
const _llmServicesConfigApiCheck: AreTypesFullyCompatible<LLMServicesConfig, Static<typeof LLMServicesConfigApiSchema>> = true;

// --- User Schema (for API responses, e.g., profile view) ---
// Excludes sensitive fields like passwordHash
export const UserProfileApiResponseSchema = Type.Object({
    id: Type.String(),
    email: Type.String(),
    enabled: Type.Boolean(),
    createdAt: Type.Unsafe<Date>(Type.String({ format: 'date-time' })), // MODIFIED for Date compatibility
    lastLoginAt: Type.Optional(Type.Unsafe<Date>(Type.String({ format: 'date-time' }))), // MODIFIED for Date compatibility
    hilBudget: Type.Number(),
    hilCount: Type.Number(),
    llmConfig: LLMServicesConfigApiSchema,
    chat: ChatSettingsApiSchema,
    functionConfig: Type.Record(Type.String(), Type.Record(Type.String(), Type.Any())),
});
const _userProfileApiCheck: AreTypesFullyCompatible<UserProfile, Static<typeof UserProfileApiResponseSchema>> = true;


// --- User Profile Update Schemas (for request bodies) ---
export const UpdateUserProfileApiBodySchema = Type.Object({
    user: Type.Pick(UserProfileApiResponseSchema, UpdateUserProfilePayloadProps)
});
const _updateUserProfileApiBodyCheck: AreTypesFullyCompatible<UpdateUserProfilePayload, Static<typeof UpdateUserProfileApiBodySchema>> = true;
