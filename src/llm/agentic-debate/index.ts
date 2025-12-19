/**
 * Tool-Enabled Multi-Agent Debate System
 *
 * A debate orchestration system that enables multiple LLM agents to debate topics
 * with tool access for evidence gathering and verification.
 *
 * @example
 * ```typescript
 * import { runDebate, createDefaultDebateTools } from '#llm/agentic-debate';
 *
 * const result = await runDebate({
 *   topic: 'Should we use microservices for this feature?',
 *   debaters: [
 *     { id: 'opus', name: 'Opus', type: 'llm', llm: opusLlm },
 *     { id: 'gpt5', name: 'GPT-5', type: 'llm', llm: gpt5Llm },
 *   ],
 *   config: {
 *     maxRounds: 3,
 *     tools: createDefaultDebateTools(),
 *     consensusLLM: sonnetLlm,
 *     mediatorLLM: opusLlm,
 *     verificationLLM: sonnetLlm,
 *     hitlEnabled: true,
 *   },
 * });
 * ```
 *
 * @module agentic-debate
 */

// Core types and interfaces
export type {
	// Tool types
	DebateTool,
	ToolParameterSchema,
	ToolResult,
	ToolRequest,
	ToolCallRecord,
	// Citation types
	Citation,
	CodeTrace,
	// Debater types
	DebaterConfig,
	DebaterType,
	DebatePosition,
	DebateResponse,
	IDebater,
	// State types
	DebateRound,
	DebateContext,
	DebateState,
	DebatePhase,
	// HITL types
	HitlDecision,
	HitlHandler,
	// Verification types
	Claim,
	ClaimStatus,
	VerifiedAnswer,
	SynthesizedAnswer,
	// Config and result types
	DebateConfig,
	DebateResult,
	// Streaming types
	DebateStreamEvent,
} from './toolEnabledDebate';

// Debate coordinator
export { DebateCoordinator, runDebate, createDebateCoordinator, type RunDebateOptions, type DebateEventEmitter } from './debateCoordinator';

// Debaters
export {
	// LLM debater
	LlmDebater,
	createLlmDebater,
	type LlmDebaterConfig,
	// Claude Agent SDK debater
	ClaudeAgentDebater,
	createClaudeAgentDebater,
	isClaudeAgentSdkAvailable,
	type ClaudeAgentDebaterConfig,
	// Factories
	createDebater,
	createDebaters,
	createLlmDebaters,
	getAvailableDebaterTypes,
} from './debaters';

// Tools
export {
	// Tool creation
	createDebateTool,
	wrapToolExecution,
	// Default tools
	createCodebaseSearchTool,
	createReadFileTool,
	createWebSearchTool,
	createWebFetchTool,
	createVectorSearchTool,
	// Tool presets
	createDefaultDebateTools,
	createTechnicalQATools,
	createCodeReviewTools,
	// Tool utilities
	executeToolRequests,
	formatToolResultsForPrompt,
	getToolSdkNames,
	// Tool executor interface
	type IToolExecutor,
	createDefaultToolExecutor,
} from './debateTools';

// Verification
export { freshVerificationPass, quickVerifyHasCitations, extractClaimsFromAnswer } from './debateVerification';

// Prompts (for customization)
export {
	DEBATE_SYSTEM_PROMPT,
	VERIFICATION_SYSTEM_PROMPT,
	buildInitialPositionPrompt,
	buildDebateRoundPrompt,
	buildConsensusCheckPrompt,
	buildSynthesisPrompt,
	buildVerificationPrompt,
	extractJsonFromResponse,
	parseConsensusResponse,
} from './debatePrompts';

// ============================================================================
// Factory Functions for Common Configurations
// ============================================================================

import type { LLM } from '#shared/llm/llm.model';
import { DebateCoordinator, type RunDebateOptions } from './debateCoordinator';
import { createDefaultDebateTools } from './debateTools';
import type { DebateConfig, DebaterConfig } from './toolEnabledDebate';

/**
 * Configuration for preset debate setups
 */
export interface DebatePresetConfig {
	/** Background context about the codebase or domain */
	backgroundContext?: string;
	/** Event handler for streaming updates */
	onEvent?: (event: import('./toolEnabledDebate').DebateStreamEvent) => void;
	/** Enable HITL intervention */
	hitlEnabled?: boolean;
	/** HITL handler */
	hitlHandler?: import('./toolEnabledDebate').HitlHandler;
	/** Maximum debate rounds */
	maxRounds?: number;
	/** Enable debug logging */
	debug?: boolean;
}

/**
 * Create a SOTA debate configuration with multiple frontier models
 *
 * Uses: Claude Opus, GPT-5, Gemini Pro
 */
export function createSOTADebate(
	topic: string,
	llms: {
		opus: LLM;
		gpt5: LLM;
		gemini: LLM;
		sonnet: LLM; // For consensus and verification
	},
	presetConfig?: DebatePresetConfig,
): DebateCoordinator {
	const debaters: DebaterConfig[] = [
		{ id: 'opus', name: 'Claude Opus', type: 'llm', llm: llms.opus },
		{ id: 'gpt5', name: 'GPT-5', type: 'llm', llm: llms.gpt5 },
		{ id: 'gemini', name: 'Gemini Pro', type: 'llm', llm: llms.gemini },
	];

	const config: DebateConfig = {
		maxRounds: presetConfig?.maxRounds ?? 3,
		tools: createDefaultDebateTools(),
		consensusLLM: llms.sonnet,
		mediatorLLM: llms.opus,
		verificationLLM: llms.sonnet,
		hitlEnabled: presetConfig?.hitlEnabled ?? false,
		hitlHandler: presetConfig?.hitlHandler,
		debug: presetConfig?.debug,
	};

	return new DebateCoordinator({
		topic,
		backgroundContext: presetConfig?.backgroundContext,
		debaters,
		config,
		onEvent: presetConfig?.onEvent,
	});
}

/**
 * Create a fast debate configuration with a single model (self-debate)
 *
 * Uses temperature variation to get diverse perspectives from the same model
 */
export function createFastDebate(topic: string, llm: LLM, presetConfig?: DebatePresetConfig): DebateCoordinator {
	const debaters: DebaterConfig[] = [
		{ id: 'agent1', name: 'Perspective 1', type: 'llm', llm, persona: 'Focus on potential benefits and opportunities.' },
		{ id: 'agent2', name: 'Perspective 2', type: 'llm', llm, persona: 'Focus on potential risks and challenges.' },
		{ id: 'agent3', name: 'Perspective 3', type: 'llm', llm, persona: 'Focus on practical implementation considerations.' },
	];

	const config: DebateConfig = {
		maxRounds: presetConfig?.maxRounds ?? 2,
		tools: createDefaultDebateTools(),
		consensusLLM: llm,
		mediatorLLM: llm,
		verificationLLM: llm,
		hitlEnabled: presetConfig?.hitlEnabled ?? false,
		hitlHandler: presetConfig?.hitlHandler,
		debug: presetConfig?.debug,
	};

	return new DebateCoordinator({
		topic,
		backgroundContext: presetConfig?.backgroundContext,
		debaters,
		config,
		onEvent: presetConfig?.onEvent,
	});
}

/**
 * Create a debate with Claude Agent SDK debaters (cheapest with Claude Code subscription)
 */
export function createClaudeAgentDebate(topic: string, verificationLLM: LLM, presetConfig?: DebatePresetConfig): DebateCoordinator {
	const debaters: DebaterConfig[] = [
		{ id: 'agent1', name: 'Claude Agent 1', type: 'claude-agent-sdk' },
		{ id: 'agent2', name: 'Claude Agent 2', type: 'claude-agent-sdk', persona: 'Be skeptical and critically evaluate all claims.' },
	];

	const config: DebateConfig = {
		maxRounds: presetConfig?.maxRounds ?? 2,
		tools: createDefaultDebateTools(),
		consensusLLM: verificationLLM,
		mediatorLLM: verificationLLM,
		verificationLLM: verificationLLM,
		hitlEnabled: presetConfig?.hitlEnabled ?? false,
		hitlHandler: presetConfig?.hitlHandler,
		debug: presetConfig?.debug,
	};

	return new DebateCoordinator({
		topic,
		backgroundContext: presetConfig?.backgroundContext,
		debaters,
		config,
		onEvent: presetConfig?.onEvent,
	});
}
