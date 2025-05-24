import { type Static, Type } from '@sinclair/typebox';
    // ... other imports

    // Schema for fields truly common to all LlmMessage types with consistent optionality
    const LlmMessageBaseSchema = Type.Object({
    	llmId: Type.Optional(Type.String()),
    	cache: Type.Optional(Type.Literal('ephemeral')),
    	providerOptions: Type.Optional(Type.Record(Type.String(), Type.Any())),
    });
    // Note: LlmMessageSpecificFieldsSchema should be replaced by LlmMessageBaseSchema or removed if all fields are now role-specific.

    // --- LlmMessage Schema redefined as a discriminated union ---

    // Remove time and stats from the old LlmMessageSpecificFieldsSchema.
    // Define them per message type.

    const SystemMessageSchema = Type.Intersect(
    	[
    		Type.Object({
    			role: Type.Literal('system'),
    			content: Type.String(),
    			time: Type.Optional(Type.Number()), // Explicitly define time, assuming optional
    			stats: Type.Optional(GenerationStatsSchema), // Explicitly define stats, assuming optional
    		}),
    		LlmMessageBaseSchema, // Intersect with other common fields
    	],
    	{ $id: 'SystemMessage' },
    );
    // ... (type check for SystemMessageSchema)

    const UserMessageSchema = Type.Intersect(
    	[
    		Type.Object({
    			role: Type.Literal('user'),
    			content: UserContentSchema,
    			time: Type.Number(), // Made required for User messages
    			stats: Type.Optional(GenerationStatsSchema), // Stats remain optional for User messages
    		}),
    		LlmMessageBaseSchema, // Intersect with other common fields
    	],
    	{ $id: 'UserMessage' },
    );
    // ... (type check for UserMessageSchema)

    const AssistantMessageSchema = Type.Intersect(
    	[
    		Type.Object({
    			role: Type.Literal('assistant'),
    			content: AssistantContentSchema,
    			time: Type.Optional(Type.Number()), // Time remains optional for Assistant messages
    			stats: GenerationStatsSchema, // Made required for Assistant messages
    		}),
    		LlmMessageBaseSchema, // Intersect with other common fields
    	],
    	{ $id: 'AssistantMessage' },
    );
    // ... (type check for AssistantMessageSchema)

    const ToolMessageSchema = Type.Intersect(
    	[
    		Type.Object({
    			role: Type.Literal('tool'),
    			content: ToolContentSchema,
    			time: Type.Optional(Type.Number()), // Explicitly define time, assuming optional
    			stats: Type.Optional(GenerationStatsSchema), // Explicitly define stats, assuming optional
    		}),
    		LlmMessageBaseSchema, // Intersect with other common fields
    	],
    	{ $id: 'ToolMessage' },
    );
    // ... (type check for ToolMessageSchema)

    export const LlmMessageSchema = Type.Union([SystemMessageSchema, UserMessageSchema, AssistantMessageSchema, ToolMessageSchema], { $id: 'LlmMessage' });
    // ... (LlmMessageCheck)

    export const LlmMessagesSchema = Type.Array(LlmMessageSchema);

    // ... rest of the file
