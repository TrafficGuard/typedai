import { randomUUID } from 'node:crypto';
import type { CreateLlmRequest } from '#llm/llmCallService/llmCall';
import { CallerId, type LlmCallService } from '#llm/llmCallService/llmCallService';
import { type LlmCall, LlmRequest } from '#shared/model/llmCall.model';

export class PostgresLlmCallService implements LlmCallService {

}
