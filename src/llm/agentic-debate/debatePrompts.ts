/**
 * Prompt templates for the multi-agent debate system.
 *
 * All prompts emphasize:
 * - Evidence-based reasoning with citations
 * - Critical evaluation of claims
 * - Use of tools to verify information
 *
 * @module agentic-debate/prompts
 */

import type { Citation, CodeTrace, DebateContext, DebatePosition, DebateTool, SynthesizedAnswer, ToolCallRecord } from './toolEnabledDebate';

// ============================================================================
// System Prompts
// ============================================================================

/**
 * Base system prompt for debate participants
 */
export const DEBATE_SYSTEM_PROMPT = `You are a critical analyst participating in a multi-agent debate to find the most accurate answer.

EVIDENCE REQUIREMENTS:
- Every factual claim MUST be supported by evidence
- Use Search_codebase to find relevant files and code patterns
- Use Read_file to extract specific code snippets as evidence
- Use WebSearch to verify claims against documentation
- Use WebFetch to read specific documentation pages
- Include file paths, line numbers, and URLs for ALL citations

CRITICAL EVALUATION:
- Scrutinize all claims, including your own
- Request verification for unsupported claims
- Point out contradictions or inaccuracies
- Update your position when presented with better evidence
- Be willing to change your mind based on new evidence

RESPONSE FORMAT:
- Clearly state your position
- Provide detailed reasoning
- Include all supporting citations
- Express your confidence level (0-1)`;

/**
 * System prompt for the verification agent
 */
export const VERIFICATION_SYSTEM_PROMPT = `You are a fact-checker reviewing an AI-generated answer. Your task is to verify each claim independently.

Your role is to be skeptical and thorough:
- Treat all claims as unverified until you confirm them
- Use tools to find supporting evidence for each claim
- Mark claims as VERIFIED, UNVERIFIED, or INCORRECT
- Provide corrections with citations for incorrect claims
- Do not accept claims at face value

You MUST provide URLs or file paths as evidence for verified claims.`;

// ============================================================================
// Initial Position Prompt
// ============================================================================

/**
 * Builds the prompt for generating an initial position
 */
export function buildInitialPositionPrompt(topic: string, context: DebateContext): string {
	const toolsList = formatToolsList(context.tools);

	return `${DEBATE_SYSTEM_PROMPT}

TOPIC TO ANALYZE:
${topic}

${context.backgroundContext ? `BACKGROUND CONTEXT:\n${context.backgroundContext}\n` : ''}

AVAILABLE TOOLS:
${toolsList}

TASK:
1. Analyze the topic thoroughly
2. Use the available tools to gather evidence
3. Form a well-reasoned position supported by citations
4. Consider multiple perspectives before settling on your position

Respond with a JSON object in the following format:
\`\`\`json
{
  "position": "Your main position/argument (1-3 sentences)",
  "confidence": 0.85,
  "reasoning": "Detailed reasoning explaining your position...",
  "citations": [
    {
      "type": "file",
      "source": "src/path/to/file.ts",
      "excerpt": "relevant code snippet...",
      "lineNumbers": [10, 25]
    },
    {
      "type": "url",
      "source": "https://docs.example.com/page",
      "excerpt": "relevant quote from documentation..."
    }
  ],
  "codeTraces": [
    {
      "description": "How the request flows through the system",
      "files": ["src/a.ts", "src/b.ts"],
      "excerpt": "code showing the flow..."
    }
  ],
  "toolRequests": [
    {
      "toolName": "Search_codebase",
      "parameters": { "pattern": "searchPattern" }
    }
  ]
}
\`\`\`

Include toolRequests if you need more information to strengthen your position.`;
}

// ============================================================================
// Debate Round Prompt
// ============================================================================

/**
 * Builds the prompt for a debate round response
 */
export function buildDebateRoundPrompt(topic: string, context: DebateContext, neighborPositions: DebatePosition[]): string {
	const toolsList = formatToolsList(context.tools);
	const neighborsText = formatNeighborPositions(neighborPositions);
	const previousToolResults = formatToolResults(context.sharedToolResults);

	return `${DEBATE_SYSTEM_PROMPT}

DEBATE ROUND ${context.round}

TOPIC:
${topic}

${context.backgroundContext ? `BACKGROUND CONTEXT:\n${context.backgroundContext}\n` : ''}

OTHER AGENTS' POSITIONS:
${neighborsText}

${previousToolResults ? `SHARED TOOL RESULTS FROM THIS ROUND:\n${previousToolResults}\n` : ''}

AVAILABLE TOOLS:
${toolsList}

TASK:
1. CRITICALLY evaluate the other agents' positions
2. Identify any unsupported or incorrect claims
3. Use tools to verify or refute specific claims
4. Update your position based on the new evidence and arguments
5. Provide citations for all your claims

Consider:
- Are the other agents' claims supported by evidence?
- Are there contradictions between positions?
- What additional evidence would strengthen or weaken each position?
- Should you update your position based on compelling arguments?

Respond with a JSON object in the same format as before:
\`\`\`json
{
  "position": "Your updated position...",
  "confidence": 0.85,
  "reasoning": "Why you hold this position, addressing other arguments...",
  "citations": [...],
  "codeTraces": [...],
  "toolRequests": [...]
}
\`\`\``;
}

// ============================================================================
// Consensus Check Prompt
// ============================================================================

/**
 * Builds the prompt for checking consensus
 */
export function buildConsensusCheckPrompt(positions: DebatePosition[]): string {
	const positionsSummary = positions
		.map(
			(p, i) => `AGENT ${i + 1} (${p.agentId}):
Position: ${p.position}
Confidence: ${p.confidence}
Key reasoning: ${(p.reasoning ?? '').slice(0, 500)}${(p.reasoning?.length ?? 0) > 500 ? '...' : ''}`,
		)
		.join('\n\n');

	return `You are evaluating whether multiple AI responses have reached consensus.

POSITIONS TO EVALUATE:
${positionsSummary}

CRITERIA FOR CONSENSUS:
- The core conclusions/recommendations are the same
- The main factual claims are consistent
- Minor differences in phrasing or emphasis do NOT break consensus
- Different supporting evidence for the same conclusion is OK

Respond with EXACTLY one of these formats:

If consensus is reached:
CONSISTENT
[Brief explanation of the common ground]

If consensus is NOT reached:
INCONSISTENT
[Brief explanation of the key disagreements]`;
}

// ============================================================================
// Synthesis Prompt
// ============================================================================

/**
 * Builds the prompt for synthesizing the final answer
 */
export function buildSynthesisPrompt(topic: string, positions: DebatePosition[]): string {
	const positionsText = positions
		.map(
			(p, i) => `<agent_position id="${p.agentId}" confidence="${p.confidence}">
POSITION: ${p.position}

REASONING:
${p.reasoning}

CITATIONS:
${formatCitations(p.citations)}

${p.codeTraces.length > 0 ? `CODE TRACES:\n${formatCodeTraces(p.codeTraces)}` : ''}
</agent_position>`,
		)
		.join('\n\n');

	return `You are synthesizing the results of a multi-agent debate into a final answer.

ORIGINAL TOPIC:
${topic}

AGENT POSITIONS AFTER DEBATE:
${positionsText}

TASK:
1. Identify the strongest elements and insights from each position
2. Resolve any remaining contradictions by determining the most accurate position
3. Combine the best elements into a comprehensive response
4. Preserve ALL relevant citations from the agents
5. Note any areas of remaining uncertainty

Respond with a JSON object:
\`\`\`json
{
  "answer": "The comprehensive synthesized answer...",
  "keyPoints": [
    { "agentId": "agent1", "points": ["key insight 1", "key insight 2"] },
    { "agentId": "agent2", "points": ["key insight 1"] }
  ],
  "citations": [
    {
      "type": "file",
      "source": "path/to/file",
      "excerpt": "...",
      "lineNumbers": [10, 20]
    }
  ],
  "confidence": 0.9
}
\`\`\``;
}

// ============================================================================
// Verification Prompt
// ============================================================================

/**
 * Builds the prompt for the fresh verification pass
 */
export function buildVerificationPrompt(topic: string, synthesizedAnswer: SynthesizedAnswer, tools: DebateTool[]): string {
	const toolsList = formatToolsList(tools);

	return `${VERIFICATION_SYSTEM_PROMPT}

ORIGINAL TOPIC:
${topic}

ANSWER TO VERIFY:
${synthesizedAnswer.answer}

EXISTING CITATIONS PROVIDED:
${formatCitations(synthesizedAnswer.citations)}

AVAILABLE TOOLS:
${toolsList}

TASK:
1. Identify each factual claim in the answer
2. For EACH claim, use the available tools to independently verify it
3. Do NOT trust the existing citations without checking them
4. Mark each claim as:
   - VERIFIED: You found supporting evidence (provide citation)
   - UNVERIFIED: You could not find evidence either way
   - INCORRECT: You found contradicting evidence (provide correction)
5. If you find errors, provide corrections with citations
6. Output your final verified answer with all citations

Respond with a JSON object:
\`\`\`json
{
  "verifiedAnswer": "The corrected/verified answer with any necessary fixes...",
  "claims": [
    {
      "claim": "The specific claim being verified",
      "status": "verified",
      "citation": {
        "type": "file",
        "source": "path/to/file.ts",
        "excerpt": "supporting evidence...",
        "lineNumbers": [10, 15]
      }
    },
    {
      "claim": "Another claim",
      "status": "incorrect",
      "correction": "The correct information is..."
    }
  ],
  "corrections": ["Description of correction 1", "Description of correction 2"],
  "citations": [...]
}
\`\`\``;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Formats the list of available tools for prompts
 */
export function formatToolsList(tools: DebateTool[]): string {
	return tools
		.map(
			(tool) => `- ${tool.name}: ${tool.description}
  Parameters: ${JSON.stringify(tool.parameters, null, 2)}`,
		)
		.join('\n\n');
}

/**
 * Formats neighbor positions for the debate round prompt
 */
export function formatNeighborPositions(positions: DebatePosition[]): string {
	if (positions.length === 0) return 'No other positions available yet.';

	return positions
		.map(
			(p) => `<neighbor_position agent="${p.agentId}" confidence="${p.confidence}">
POSITION: ${p.position}

REASONING:
${p.reasoning}

CITATIONS:
${formatCitations(p.citations)}
</neighbor_position>`,
		)
		.join('\n\n');
}

/**
 * Formats citations for inclusion in prompts
 */
export function formatCitations(citations: Citation[]): string {
	if (citations.length === 0) return 'None provided';

	return citations
		.map((c) => {
			const location = c.lineNumbers ? `:${c.lineNumbers[0]}-${c.lineNumbers[1]}` : '';
			return `- [${c.type}] ${c.source}${location}
  "${c.excerpt}"`;
		})
		.join('\n');
}

/**
 * Formats code traces for inclusion in prompts
 */
export function formatCodeTraces(traces: CodeTrace[]): string {
	if (traces.length === 0) return 'None provided';

	return traces
		.map(
			(t) => `- ${t.description}
  Files: ${t.files.join(' -> ')}
  \`\`\`
  ${t.excerpt}
  \`\`\``,
		)
		.join('\n');
}

/**
 * Formats tool results for inclusion in prompts
 */
export function formatToolResults(toolCalls: ToolCallRecord[]): string {
	if (toolCalls.length === 0) return '';

	return toolCalls
		.map((call) => {
			const status = call.result.success ? 'SUCCESS' : 'ERROR';
			const content = call.result.success
				? typeof call.result.data === 'string'
					? call.result.data
					: JSON.stringify(call.result.data, null, 2)
				: call.result.error;

			// Truncate very long results
			const truncatedContent = content && content.length > 5000 ? `${content.slice(0, 5000)}\n... [truncated]` : content;

			return `<tool_result name="${call.toolName}" agent="${call.agentId}" status="${status}">
${truncatedContent}
</tool_result>`;
		})
		.join('\n\n');
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Extracts JSON from an LLM response that may contain markdown code blocks
 */
export function extractJsonFromResponse<T>(response: string): T {
	// Try to find JSON in code blocks first
	const jsonBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonBlockMatch) {
		return JSON.parse(jsonBlockMatch[1].trim()) as T;
	}

	// Try to find raw JSON object
	const jsonMatch = response.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		return JSON.parse(jsonMatch[0]) as T;
	}

	throw new Error('No valid JSON found in response');
}

/**
 * Parses a consensus check response
 */
export function parseConsensusResponse(response: string): { isConsistent: boolean; explanation: string } {
	const upperResponse = response.toUpperCase().trim();
	const isConsistent = upperResponse.startsWith('CONSISTENT');

	// Extract explanation (everything after the first line)
	const lines = response.trim().split('\n');
	const explanation = lines.slice(1).join('\n').trim();

	return { isConsistent, explanation };
}
