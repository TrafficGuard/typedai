import { BaseLLM, type BaseLlmConfig, costPerMilTokens } from '#llm/base-llm';
import { logger } from '#o11y/logger';
import type { GenerateTextOptions, LLM, LlmCostFunction, LlmMessage } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { execCommand } from '#utils/exec';

export const CLAUDE_CODE_SERVICE = 'claude-code';

/**
 * Response format from Claude Code CLI with --output-format json
 */
interface ClaudeCodeResponse {
	type: 'result';
	subtype: 'success' | 'error';
	result: string;
	total_cost_usd: number;
	duration_ms: number;
	duration_api_ms?: number;
	num_turns: number;
	session_id: string;
	is_error: boolean;
}

export function claudeCodeLLMRegistry(): Array<() => LLM> {
	return [claudeCodeDefault];
}

export function claudeCodeDefault(): LLM {
	return new ClaudeCode('Claude Code', 'claude-code', 200_000, costPerMilTokens(3, 15));
}

export class ClaudeCode extends BaseLLM {
	constructor(displayName: string, modelId: string, maxInputTokens: number, calculateCosts: LlmCostFunction) {
		super({
			displayName,
			service: CLAUDE_CODE_SERVICE,
			modelId,
			maxInputTokens,
			calculateCosts,
		});
	}

	protected override async _generateText(systemPrompt: string | undefined, userPrompt: string, opts?: GenerateTextOptions): Promise<string> {
		const startTime = Date.now();

		let command = `claude -p ${this.escapeShellArg(userPrompt)} --output-format json`;

		if (systemPrompt) command += ` --append-system-prompt ${this.escapeShellArg(systemPrompt)}`;

		logger.debug({ command }, 'Executing Claude Code CLI command');

		// Execute the command
		const result = await execCommand(command);

		if (result.exitCode !== 0) throw new Error(`Claude Code CLI execution failed: ${result.stderr || 'Unknown error'}`);

		// Parse the JSON response
		let response: ClaudeCodeResponse;
		try {
			response = JSON.parse(result.stdout);
		} catch (e) {
			logger.error({ stdout: result.stdout }, 'Failed to parse Claude Code JSON response');
			throw new Error(`Failed to parse Claude Code response: ${e instanceof Error ? e.message : String(e)}`);
		}

		// Check for errors in the response
		if (response.is_error || response.subtype === 'error') throw new Error(`Claude Code error: ${response.result}`);

		// Log stats for monitoring
		logger.debug(
			{
				cost: response.total_cost_usd,
				duration: response.duration_ms,
				apiDuration: response.duration_api_ms,
				turns: response.num_turns,
				sessionId: response.session_id,
			},
			'Claude Code response stats',
		);

		return response.result;
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.anthropicKey?.trim() || process.env.ANTHROPIC_API_KEY;
	}

	// override isConfigured(): boolean {
	// 	// Claude Code requires the CLI to be installed
	// 	// We return true here and let it fail at execution time with a clear error
	// 	// A proper async check would require execCommand which this synchronous method doesn't support
	// 	return true;
	// }

	/**
	 * Escapes a string for safe use as a shell argument.
	 * Uses single quotes and escapes any single quotes in the string.
	 */
	private escapeShellArg(arg: string): string {
		return `'${arg.replace(/'/g, "'\\''")}'`;
	}
}
