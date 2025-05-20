import {type Static, Type} from '@sinclair/typebox';
// Source of Truth Model Interfaces
import type {ChatSettings, LLMServicesConfig, User} from '#shared/model/user.model';
import type {AreTypesFullyCompatible} from '../utils/type-compatibility';

// -- User model sub-component schemas -- --

export const ChatSettingsModelSchema = Type.Object({
    enabledLLMs: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
    defaultLLM: Type.Optional(Type.String()),
    temperature: Type.Optional(Type.Number()),
    topP: Type.Optional(Type.Number()),
    topK: Type.Optional(Type.Number()),
    presencePenalty: Type.Optional(Type.Number()),
    frequencyPenalty: Type.Optional(Type.Number()),
});
const _chatSettingsApiCheck: AreTypesFullyCompatible<ChatSettings, Static<typeof ChatSettingsModelSchema>> = true;

export const LLMServicesConfigModelSchema = Type.Object({
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
const _llmServicesConfigApiCheck: AreTypesFullyCompatible<LLMServicesConfig, Static<typeof LLMServicesConfigModelSchema>> = true;

// -- User profile schemas -- --
export const UserProfileProps = ['id', 'name', 'email', 'enabled', 'hilBudget', 'hilCount', 'llmConfig', 'chat', 'functionConfig'] as const;
export const UserProfileUpdateProps = ['hilBudget', 'hilCount', 'llmConfig', 'chat', 'functionConfig'] as const;

/**
 * The user profile data returned by the API (excluding sensitive fields).
 */
export type UserProfile = Pick<User, typeof UserProfileProps[number]>;
/**
 * The profile data that users can update themselves
 */
export type UserProfileUpdate = Pick<UserProfile, typeof UserProfileUpdateProps[number]>;


export const UserSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    email: Type.String(),
    enabled: Type.Boolean(),
    passwordHash: Type.Optional(Type.String()),
    createdAt: Type.Date(),
    lastLoginAt: Type.Optional(Type.Date()),
    hilBudget: Type.Number(),
    hilCount: Type.Number(),
    llmConfig: LLMServicesConfigModelSchema,
    chat: ChatSettingsModelSchema,
    functionConfig: Type.Record(Type.String(), Type.Record(Type.String(), Type.Any())),
});
const _userCheck: AreTypesFullyCompatible<User, Static<typeof UserSchema>> = true;


/**
 * The user profile data returned by the API (excluding sensitive fields).
 */
export const UserProfileSchema = Type.Pick(UserSchema, UserProfileProps, { $id: 'UserProfile' });
// export const UserProfileSchema = Type.Object({
//     id: Type.String(),
//     name: Type.String(),
//     email: Type.String(),
//     enabled: Type.Boolean(),
//     hilBudget: Type.Number(),
//     hilCount: Type.Number(),
//     llmConfig: LLMServicesConfigModelSchema,
//     chat: ChatSettingsModelSchema,
//     functionConfig: Type.Record(Type.String(), Type.Record(Type.String(), Type.Any())),
// });
const _userProfileCheck: AreTypesFullyCompatible<UserProfile, Static<typeof UserProfileSchema>> = true;

/**
 * The profile data that users can update themselves
 */
export const UserProfileUpdateSchema = Type.Pick(UserProfileSchema, UserProfileUpdateProps)
const _userProfileUpdateCheck: AreTypesFullyCompatible<UserProfileUpdate, Static<typeof UserProfileUpdateSchema>> = true;
