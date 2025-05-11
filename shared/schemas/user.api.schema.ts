import { Type, type Static } from '@sinclair/typebox';
// Source of Truth Model Interfaces
import type {
    User,
    ChatSettings,
    LLMServicesConfig,
} from '#shared/model/user.model'; // Adjust path
// Compatibility Checker
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';

// --- ChatSettings Schema ---
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

// --- LLMServicesConfig Schema ---
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
    // createdAt: Type.String({ format: 'date-time' }), // Or Type.Number() if timestamp
    // lastLoginAt: Type.Optional(Type.String({ format: 'date-time' })),
    // For simplicity, using Any for dates. For production, use specific format or number.
    createdAt: Type.Any(),
    lastLoginAt: Type.Optional(Type.Any()),
    hilBudget: Type.Number(),
    hilCount: Type.Number(),
    llmConfig: LLMServicesConfigApiSchema,
    chat: ChatSettingsApiSchema,
    functionConfig: Type.Record(Type.String(), Type.Record(Type.String(), Type.Any())),
});
// type UserProfileModel = Omit<User, 'passwordHash'>; // Define this in user.model.ts if needed
// const _userProfileApiCheck: AreTypesFullyCompatible<UserProfileModel, Static<typeof UserProfileApiResponseSchema>> = true;


// --- User Profile Update Schemas (for request bodies) ---
// Based on profile-route.ts, it seems only 'email' and 'chat' settings are updatable.
export const UpdateUserProfileApiBodySchema = Type.Object({
    user: Type.Object({ // Matches the nesting in profile-route.ts
        email: Type.Optional(Type.String()), // Assuming email can be updated
        chat: Type.Optional(ChatSettingsApiSchema),
        // llmConfig: Type.Optional(LLMServicesConfigApiSchema), // If llmConfig is also updatable
    }),
});
// Define a model for this specific update payload if you want a compatibility check.
// e.g., interface UpdateUserProfilePayload { user: { email?: string; chat?: Partial<ChatSettings> } }
