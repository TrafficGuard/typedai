/**
 * Tool-Enabled Multi-Agent Debate System
 *
 * A debate orchestration system that enables multiple LLM agents to debate topics
 * with tool access for evidence gathering and verification. Features:
 *
 * 1. Multiple debater backends (standard LLMs, Claude Agent SDK)
 * 2. Configurable tools for codebase search, web search, file reading
 * 3. Sparse topology debate (agents see neighbors to reduce groupthink)
 * 4. Consensus detection with HITL fallback
 * 5. Fresh verification pass to avoid context pollution
 *
 * @module agentic-debate
 */

import type { LLM } from '#shared/llm/llm.model';

// ============================================================================
// Core Types
// ============================================================================

export type DebatePhase = 'initial' | 'debate' | 'consensus' | 'synthesis' | 'verification' | 'hitl' | 'complete' | 'error';

export type ClaimStatus = 'verified' | 'unverified' | 'incorrect';

export type DebaterType = 'llm' | 'claude-agent-sdk';

// ============================================================================
// Tool Interfaces
// ============================================================================

/**
 * Schema for tool parameters (JSON Schema compatible)
 */
export interface ToolParameterSchema {
	type: 'string' | 'number' | 'boolean' | 'object' | 'array';
	description?: string;
	required?: boolean;
	properties?: Record<string, ToolParameterSchema>;
	items?: ToolParameterSchema;
}

/**
 * Result from tool execution
 */
export interface ToolResult {
	success: boolean;
	data?: unknown;
	error?: string;
	/** Time taken to execute in ms */
	executionTimeMs?: number;
}

/**
 * A tool that can be used by debaters during the debate
 */
export interface DebateTool {
	/** Internal name for the tool */
	name: string;
	/** Claude Agent SDK tool name (e.g., "WebSearch", "Read") */
	sdkName?: string;
	/** Human-readable description */
	description: string;
	/** Parameter schema */
	parameters: Record<string, ToolParameterSchema>;
	/** Execute the tool with given parameters */
	execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Request from a debater to use a tool
 */
export interface ToolRequest {
	toolName: string;
	parameters: Record<string, unknown>;
}

/**
 * Record of a tool call made during debate
 */
export interface ToolCallRecord {
	toolName: string;
	parameters: Record<string, unknown>;
	result: ToolResult;
	timestamp: Date;
	agentId: string;
}

// ============================================================================
// Citation & Evidence Interfaces
// ============================================================================

/**
 * A citation supporting a claim
 */
export interface Citation {
	type: 'file' | 'url' | 'document';
	/** File path or URL */
	source: string;
	/** Relevant excerpt from the source */
	excerpt: string;
	/** Line numbers for file citations [start, end] */
	lineNumbers?: [number, number];
}

/**
 * A code trace showing execution flow
 */
export interface CodeTrace {
	/** Description of what the trace shows */
	description: string;
	/** Files involved in the trace */
	files: string[];
	/** Code excerpt showing the flow */
	excerpt: string;
}

// ============================================================================
// Debater Interfaces
// ============================================================================

/**
 * Configuration for a single debater agent
 */
export interface DebaterConfig {
	/** Unique identifier for this debater */
	id: string;
	/** Display name */
	name: string;
	/** Type of debater backend */
	type: DebaterType;
	/** LLM instance (for 'llm' type) */
	llm?: LLM;
	/** Optional persona/instructions */
	persona?: string;
}

/**
 * A position taken by a debater in the debate
 */
export interface DebatePosition {
	/** ID of the debater who holds this position */
	agentId: string;
	/** The main position/argument */
	position: string;
	/** Confidence level 0-1 */
	confidence: number;
	/** Detailed reasoning */
	reasoning: string;
	/** Citations supporting the position */
	citations: Citation[];
	/** Code traces as evidence */
	codeTraces: CodeTrace[];
	/** Tool calls made to gather evidence */
	toolCalls: ToolCallRecord[];
}

/**
 * Response from a debater during a round
 */
export interface DebateResponse {
	position: string;
	confidence: number;
	reasoning: string;
	citations: Citation[];
	codeTraces: CodeTrace[];
	/** Optional requests for tools to gather more evidence */
	toolRequests?: ToolRequest[];
}

/**
 * Interface that all debater implementations must satisfy
 */
export interface IDebater {
	readonly id: string;
	readonly name: string;
	readonly type: DebaterType;

	/**
	 * Generate an initial position on the topic
	 */
	generateInitialPosition(topic: string, context: DebateContext): Promise<DebateResponse>;

	/**
	 * Generate a response in a debate round, considering other positions
	 */
	generateDebateResponse(topic: string, context: DebateContext, neighborPositions: DebatePosition[]): Promise<DebateResponse>;
}

// ============================================================================
// Debate State & Context
// ============================================================================

/**
 * A single round of debate
 */
export interface DebateRound {
	round: number;
	positions: DebatePosition[];
	toolCalls: ToolCallRecord[];
	consensusReached: boolean;
	timestamp: Date;
}

/**
 * Context passed to debaters during the debate
 */
export interface DebateContext {
	/** Original topic/question */
	topic: string;
	/** Additional context (e.g., codebase info) */
	backgroundContext?: string;
	/** Available tools */
	tools: DebateTool[];
	/** Current round number */
	round: number;
	/** Previous rounds history */
	previousRounds: DebateRound[];
	/** Shared tool results from this round */
	sharedToolResults: ToolCallRecord[];
}

/**
 * Complete state of a debate session
 */
export interface DebateState {
	debateId: string;
	topic: string;
	phase: DebatePhase;
	currentRound: number;
	rounds: DebateRound[];
	debaters: DebaterConfig[];
	config: DebateConfig;
	startTime: Date;
	endTime?: Date;
	error?: string;
}

// ============================================================================
// HITL (Human-in-the-Loop) Interfaces
// ============================================================================

/**
 * Decision from human intervention
 */
export interface HitlDecision {
	/** Human selected one of the agent positions */
	selectedAgentId?: string;
	/** Human provided a custom answer */
	customAnswer?: string;
	/** Human provided feedback/guidance */
	feedback?: string;
}

/**
 * Handler for HITL requests
 */
export type HitlHandler = (state: DebateState) => Promise<HitlDecision>;

// ============================================================================
// Verification Interfaces
// ============================================================================

/**
 * A claim extracted from the synthesized answer
 */
export interface Claim {
	/** The claim text */
	claim: string;
	/** Verification status */
	status: ClaimStatus;
	/** Citation supporting the claim (if verified) */
	citation?: Citation;
	/** Correction if the claim is incorrect */
	correction?: string;
}

/**
 * Result of the fresh verification pass
 */
export interface VerifiedAnswer {
	/** Original synthesized answer */
	originalAnswer: string;
	/** Verified/corrected answer */
	verifiedAnswer: string;
	/** Individual claim verifications */
	claims: Claim[];
	/** Any corrections made */
	corrections: string[];
	/** All citations gathered during verification */
	citations: Citation[];
}

/**
 * Synthesized answer from the debate
 */
export interface SynthesizedAnswer {
	/** The combined answer */
	answer: string;
	/** Key points from each agent */
	keyPoints: Array<{ agentId: string; points: string[] }>;
	/** Combined citations */
	citations: Citation[];
	/** Confidence level */
	confidence: number;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the debate system
 */
export interface DebateConfig {
	/** Maximum number of debate rounds */
	maxRounds: number;
	/** LLM for consensus checking */
	consensusLLM: LLM;
	/** LLM for mediating/synthesizing */
	mediatorLLM: LLM;
	/** LLM for fresh verification pass */
	verificationLLM: LLM;
	/** Whether HITL is enabled */
	hitlEnabled: boolean;
	/** Handler for HITL requests */
	hitlHandler?: HitlHandler;
	/** Available tools for debaters */
	tools: DebateTool[];
	/** Enable debug logging */
	debug?: boolean;
}

/**
 * Result of running a debate
 */
export interface DebateResult {
	/** Unique ID for this debate */
	debateId: string;
	/** Original topic */
	topic: string;
	/** Final synthesized answer */
	synthesizedAnswer: SynthesizedAnswer;
	/** Verified answer (from fresh verification pass) */
	verifiedAnswer: VerifiedAnswer;
	/** All debate rounds */
	rounds: DebateRound[];
	/** Number of rounds taken */
	roundCount: number;
	/** Whether consensus was reached */
	consensusReached: boolean;
	/** Whether HITL was invoked */
	hitlInvoked: boolean;
	/** Total execution time in ms */
	executionTimeMs: number;
	/** Total cost (if available) */
	totalCost?: number;
}

// ============================================================================
// Streaming Events (for UI)
// ============================================================================

export type DebateStreamEvent =
	| { type: 'debate-started'; debateId: string; topic: string }
	| { type: 'round-started'; round: number }
	| { type: 'agent-thinking'; agentId: string }
	| { type: 'agent-position-delta'; agentId: string; delta: string }
	| { type: 'agent-tool-call'; agentId: string; tool: string; params: Record<string, unknown> }
	| { type: 'agent-tool-result'; agentId: string; result: ToolResult }
	| { type: 'agent-position-complete'; agentId: string; position: DebatePosition }
	| { type: 'round-complete'; round: number; consensusReached: boolean }
	| { type: 'hitl-requested'; reason: string }
	| { type: 'synthesis-started' }
	| { type: 'verification-started' }
	| { type: 'verification-claim'; claim: string; status: ClaimStatus }
	| { type: 'debate-complete'; result: DebateResult }
	| { type: 'error'; message: string };

// ============================================================================
// Factory Functions
// ============================================================================

// These will be implemented in index.ts after all components are created
// export function ToolEnabledDebate_SOTA(): ToolEnabledDebateCoordinator;
// export function ToolEnabledDebate_Fast(): ToolEnabledDebateCoordinator;
