/**
 * Frontend models for the Multi-Agent Debate system
 *
 * These interfaces mirror the backend types from src/llm/agentic-debate/toolEnabledDebate.ts
 * for use in the Angular frontend.
 *
 * @module debate/models
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

export interface ToolCallRecord {
	toolName: string;
	parameters: Record<string, unknown>;
	result: unknown;
	agentId: string;
	executionTimeMs: number;
}

// ============================================================================
// Debate Round Types
// ============================================================================

export interface DebateRound {
	round: number;
	positions: DebatePosition[];
	toolCalls: ToolCallRecord[];
	consensusReached: boolean;
	timestamp: Date;
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

export type DebatePhase = 'initial' | 'debate' | 'consensus' | 'hitl' | 'synthesis' | 'verification' | 'complete' | 'error';

export interface DebateState {
	debateId: string;
	topic: string;
	phase: DebatePhase;
	currentRound: number;
	rounds: DebateRound[];
	debaters: DebaterConfig[];
	startTime: Date;
	endTime?: Date;
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
