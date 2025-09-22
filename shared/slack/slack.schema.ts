import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import type { AreTypesFullyCompatible } from '#shared/typeUtils';
import type { SlackActionResponseModel, SlackStatusResponseModel } from './slack.model';

export const SlackStatusResponseSchema = Type.Object(
	{
		status: Type.Union([Type.Literal('connected'), Type.Literal('disconnected')]),
	},
	{ $id: 'SlackStatusResponse' },
);

export const SlackActionResponseSchema = Type.Object(
	{
		success: Type.Boolean(),
	},
	{ $id: 'SlackActionResponse' },
);

type SlackStatusResponseSchemaModel = Static<typeof SlackStatusResponseSchema>;
type SlackActionResponseSchemaModel = Static<typeof SlackActionResponseSchema>;

const _SlackStatusResponseCheck: AreTypesFullyCompatible<SlackStatusResponseModel, SlackStatusResponseSchemaModel> = true;
const _SlackActionResponseCheck: AreTypesFullyCompatible<SlackActionResponseModel, SlackActionResponseSchemaModel> = true;
