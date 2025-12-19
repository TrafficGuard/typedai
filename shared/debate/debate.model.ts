/**
 * Shared models for the Multi-Agent Debate system
 *
 * These types are shared between frontend and backend.
 *
 * @module shared/debate
 */

// ============================================================================
// Citation Types
// ============================================================================

export interface Citation {
	type: 'file' | 'url' | 'document';
	source: string;
	excerpt: string;
	lineNumbers?: [number, number];
}

export interface CodeTrace {
	description: string;
	files: string[];
	excerpt: string;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCallRecord {
	toolName: string;
	parameters: Record<string, unknown>;
	result: unknown;
	agentId: string;
	executionTimeMs: number;
	timestamp?: number;
}

// ============================================================================
// Debater Types
// ============================================================================

export type DebaterType = 'llm' | 'claude-agent-sdk';

export interface DebaterConfig {
	id: string;
	name: string;
	type: DebaterType;
	model?: string;
	persona?: string;
}

// ============================================================================
// Debate Position and Response Types
// ============================================================================

export interface DebatePosition {
	agentId: string;
	position: string;
	confidence: number;
	reasoning: string;
	citations: Citation[];
	codeTraces: CodeTrace[];
	toolCalls: ToolCallRecord[];
}

// ============================================================================
// Debate Round Types
// ============================================================================

export interface DebateRound {
	round: number;
	positions: DebatePosition[];
	toolCalls: ToolCallRecord[];
	consensusReached: boolean;
	timestamp: number; // Unix timestamp for JSON serialization
}

// ============================================================================
// Verification Types
// ============================================================================

export type ClaimStatus = 'verified' | 'unverified' | 'incorrect';

export interface Claim {
	claim: string;
	status: ClaimStatus;
	citation?: Citation;
	correction?: string;
}

export interface SynthesizedAnswer {
	answer: string;
	keyPoints: Array<{ agentId: string; points: string[] }>;
	citations: Citation[];
	confidence: number;
}

export interface VerifiedAnswer {
	originalAnswer: string;
	verifiedAnswer: string;
	claims: Claim[];
	corrections: string[];
	citations: Citation[];
}

// ============================================================================
// Debate State and Result Types
// ============================================================================

export type DebatePhase = 'initial' | 'debate' | 'consensus' | 'hitl' | 'paused' | 'synthesis' | 'verification' | 'complete' | 'error';

export interface DebateConfig {
	maxRounds: number;
	hitlEnabled: boolean;
	debug?: boolean;
}

export interface DebateState {
	debateId: string;
	userId?: string;
	topic: string;
	backgroundContext?: string;
	phase: DebatePhase;
	previousPhase?: DebatePhase; // Stores phase before pause for proper resume
	currentRound: number;
	rounds: DebateRound[];
	debaters: DebaterConfig[];
	config: DebateConfig;
	hitlDecision?: HitlDecision; // Stores the human decision when HITL is invoked
	startTime: number; // Unix timestamp
	endTime?: number; // Unix timestamp
	error?: string;
}

export interface DebateResult {
	debateId: string;
	topic: string;
	synthesizedAnswer: SynthesizedAnswer;
	verifiedAnswer: VerifiedAnswer;
	rounds: DebateRound[];
	roundCount: number;
	consensusReached: boolean;
	hitlInvoked: boolean;
	executionTimeMs: number;
	totalCost?: number;
}

// ============================================================================
// Streaming Event Types (for SSE)
// ============================================================================

export type DebateStreamEvent =
	| { type: 'debate-started'; debateId: string; topic: string }
	| { type: 'round-started'; round: number }
	| { type: 'agent-thinking'; agentId: string }
	| { type: 'agent-position-delta'; agentId: string; delta: string }
	| { type: 'agent-tool-call'; agentId: string; tool: string; params: unknown }
	| { type: 'agent-tool-result'; agentId: string; result: unknown }
	| { type: 'agent-position-complete'; agentId: string; position: DebatePosition }
	| { type: 'round-complete'; round: number; consensusReached: boolean }
	| { type: 'hitl-requested'; reason: string }
	| { type: 'synthesis-started' }
	| { type: 'verification-started' }
	| { type: 'verification-claim'; claim: string; status: ClaimStatus }
	| { type: 'debate-complete'; result: DebateResult }
	| { type: 'debate-paused' }
	| { type: 'debate-resumed' }
	| { type: 'error'; message: string };

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface StartDebateRequest {
	topic: string;
	backgroundContext?: string;
	debaters: DebaterConfig[];
	maxRounds?: number;
	hitlEnabled?: boolean;
}

export interface HitlDecision {
	selectedAgentId?: string;
	customAnswer?: string;
	feedback?: string;
}

// ============================================================================
// UI-specific Types
// ============================================================================

export type AgentStatus = 'waiting' | 'thinking' | 'active' | 'complete' | 'error';

export interface DebateList {
	debates: DebateState[];
	hasMore: boolean;
}

// ============================================================================
// Derived Type Keys for Schema
// ============================================================================

export const DEBATE_PREVIEW_KEYS = [
	'debateId',
	'userId',
	'topic',
	'phase',
	'currentRound',
	'startTime',
	'endTime',
] as const satisfies readonly (keyof DebateState)[];

export type DebatePreview = Pick<DebateState, (typeof DEBATE_PREVIEW_KEYS)[number]>;
