/**
 * Claude Agent SDK Debater implementation.
 *
 * Uses the Claude Agent SDK for native tool execution. This is the cheapest
 * option with a Claude Code subscription as it leverages the SDK's built-in
 * tool handling.
 *
 * @module agentic-debate/debaters/claudeAgentDebater
 */

import { logger } from '#o11y/logger';
import {
	DEBATE_SYSTEM_PROMPT,
	buildDebateRoundPrompt,
	buildInitialPositionPrompt,
	extractJsonFromResponse,
	formatNeighborPositions,
	formatToolsList,
} from '../debatePrompts';
import { getToolSdkNames } from '../debateTools';
import type { Citation, CodeTrace, DebateContext, DebatePosition, DebateResponse, DebaterType, IDebater } from '../toolEnabledDebate';

const log = logger.child({ module: 'ClaudeAgentDebater' });

/**
 * Configuration for the Claude Agent SDK debater
 */
export interface ClaudeAgentDebaterConfig {
	id: string;
	name: string;
	/** Optional persona/additional instructions */
	persona?: string;
	/** Model to use (defaults to claude-sonnet-4-5) */
	model?: string;
	/** Maximum turns for the SDK query (defaults to 5) */
	maxTurns?: number;
}

/**
 * Type for the Claude Agent SDK query function
 * We use `any` to avoid type conflicts with the SDK's actual types
 * since we're doing dynamic imports and the SDK may not be installed
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryFunction = any;

/**
 * Claude Agent SDK-based debater
 *
 * This debater uses the Claude Agent SDK's query() function which handles
 * tool execution natively. This is cheaper with Claude Code subscription.
 */
export class ClaudeAgentDebater implements IDebater {
	readonly id: string;
	readonly name: string;
	readonly type: DebaterType = 'claude-agent-sdk';

	private readonly persona?: string;
	private readonly model: string;
	private readonly maxTurns: number;
	private queryFn: QueryFunction | null = null;

	constructor(config: ClaudeAgentDebaterConfig) {
		this.id = config.id;
		this.name = config.name;
		this.persona = config.persona;
		this.model = config.model ?? 'opus';
		this.maxTurns = config.maxTurns ?? 50; // Allow Claude to work through complex tasks
	}

	/**
	 * Lazily load the Claude Agent SDK
	 */
	private async getQueryFunction(): Promise<QueryFunction> {
		if (this.queryFn) return this.queryFn;

		try {
			// Dynamic import to avoid build-time dependency
			const sdk = await import('@anthropic-ai/claude-agent-sdk');
			this.queryFn = sdk.query;
			return this.queryFn;
		} catch (error) {
			log.error({ error }, 'Failed to load Claude Agent SDK');
			throw new Error('Claude Agent SDK not available. Install with: npm install @anthropic-ai/claude-agent-sdk');
		}
	}

	/**
	 * Check if the Claude Agent SDK is available
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await this.getQueryFunction();
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Generate an initial position on the topic
	 */
	async generateInitialPosition(topic: string, context: DebateContext): Promise<DebateResponse> {
		log.info({ agentId: this.id, topic }, 'Generating initial position with Claude Agent SDK');

		const prompt = this.buildSdkPrompt(topic, context);
		const allowedTools = getToolSdkNames(context.tools);

		const response = await this.runQuery(prompt, allowedTools);
		return this.parseResponse(response);
	}

	/**
	 * Generate a response in a debate round
	 */
	async generateDebateResponse(topic: string, context: DebateContext, neighborPositions: DebatePosition[]): Promise<DebateResponse> {
		log.info({ agentId: this.id, round: context.round }, 'Generating debate response with Claude Agent SDK');

		const prompt = this.buildSdkDebatePrompt(topic, context, neighborPositions);
		const allowedTools = getToolSdkNames(context.tools);

		const response = await this.runQuery(prompt, allowedTools);
		return this.parseResponse(response);
	}

	/**
	 * Build the prompt for the SDK query (initial position)
	 */
	private buildSdkPrompt(topic: string, context: DebateContext): string {
		const toolsList = formatToolsList(context.tools);

		return `TOPIC TO ANALYZE:
${topic}

${context.backgroundContext ? `BACKGROUND CONTEXT:\n${context.backgroundContext}\n` : ''}

AVAILABLE TOOLS:
${toolsList}

TASK:
1. Analyze the topic thoroughly
2. Use the available tools to gather evidence
3. Form a well-reasoned position supported by citations
4. Consider multiple perspectives before settling on your position

After your analysis, provide your final response as a JSON object:
\`\`\`json
{
  "position": "Your main position/argument",
  "confidence": 0.85,
  "reasoning": "Detailed reasoning...",
  "citations": [
    { "type": "file", "source": "path/to/file.ts", "excerpt": "...", "lineNumbers": [10, 25] }
  ],
  "codeTraces": []
}
\`\`\``;
	}

	/**
	 * Build the prompt for debate rounds
	 */
	private buildSdkDebatePrompt(topic: string, context: DebateContext, neighborPositions: DebatePosition[]): string {
		const toolsList = formatToolsList(context.tools);
		const neighborsText = formatNeighborPositions(neighborPositions);

		return `DEBATE ROUND ${context.round}

TOPIC:
${topic}

${context.backgroundContext ? `BACKGROUND CONTEXT:\n${context.backgroundContext}\n` : ''}

OTHER AGENTS' POSITIONS:
${neighborsText}

AVAILABLE TOOLS:
${toolsList}

TASK:
1. CRITICALLY evaluate the other agents' positions
2. Identify any unsupported or incorrect claims
3. Use tools to verify or refute specific claims
4. Update your position based on the evidence
5. Provide citations for all your claims

After your analysis, provide your final response as a JSON object:
\`\`\`json
{
  "position": "Your updated position...",
  "confidence": 0.85,
  "reasoning": "Why you hold this position...",
  "citations": [...],
  "codeTraces": [...]
}
\`\`\``;
	}

	/**
	 * Run a query using the Claude Agent SDK
	 */
	private async runQuery(prompt: string, allowedTools: string[]): Promise<string> {
		const query = await this.getQueryFunction();
		let result = '';

		const systemPrompt = this.persona ? `${DEBATE_SYSTEM_PROMPT}\n\nADDITIONAL INSTRUCTIONS:\n${this.persona}` : DEBATE_SYSTEM_PROMPT;

		try {
			for await (const message of query({
				prompt,
				options: {
					systemPrompt,
					allowedTools,
					permissionMode: 'bypassPermissions',
					allowDangerouslySkipPermissions: true, // Required for bypassPermissions mode
					maxTurns: this.maxTurns, // Limit turns for predictable execution time
				},
			})) {
				if (message.type === 'assistant') {
					const content = message.message?.content;
					if (content) {
						for (const block of content) {
							if ('text' in block && block.text) {
								result += block.text;
							}
						}
					}
				}
			}
		} catch (error) {
			log.error({ error, agentId: this.id }, 'Error running Claude Agent SDK query');
			throw error;
		}

		return result;
	}

	/**
	 * Parse the response into a DebateResponse
	 */
	private parseResponse(response: string): DebateResponse {
		try {
			return extractJsonFromResponse<DebateResponse>(response);
		} catch (error) {
			log.warn({ agentId: this.id, error }, 'Failed to parse JSON response from Claude Agent SDK');

			// Fallback: create a basic response from the text
			return {
				position: response.slice(0, 500),
				confidence: 0.5,
				reasoning: response,
				citations: this.extractCitationsFromText(response),
				codeTraces: [],
			};
		}
	}

	/**
	 * Extract citations from unstructured text
	 */
	private extractCitationsFromText(text: string): Citation[] {
		const citations: Citation[] = [];

		// Look for file paths
		const fileMatches = text.matchAll(/(?:file|path):\s*[`"]?([^\s`"]+\.[a-z]+)[`"]?/gi);
		for (const match of fileMatches) {
			citations.push({
				type: 'file',
				source: match[1],
				excerpt: '',
			});
		}

		// Look for URLs
		const urlMatches = text.matchAll(/https?:\/\/[^\s)]+/g);
		for (const match of urlMatches) {
			citations.push({
				type: 'url',
				source: match[0],
				excerpt: '',
			});
		}

		return citations;
	}
}

/**
 * Factory function to create a Claude Agent SDK debater
 */
export function createClaudeAgentDebater(config: ClaudeAgentDebaterConfig): IDebater {
	return new ClaudeAgentDebater(config);
}

/**
 * Check if Claude Agent SDK is available
 */
export async function isClaudeAgentSdkAvailable(): Promise<boolean> {
	try {
		await import('@anthropic-ai/claude-agent-sdk');
		return true;
	} catch {
		return false;
	}
}
