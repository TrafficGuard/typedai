/**
 * Debate Coordinator - Orchestrates the multi-agent debate flow.
 *
 * Implements:
 * 1. Parallel initial position generation
 * 2. Sparse topology debate rounds (circular neighbor pattern)
 * 3. Semantic consensus checking
 * 4. HITL integration when consensus fails
 * 5. Mediator synthesis
 * 6. Fresh verification pass
 *
 * @module agentic-debate/coordinator
 */

import { randomUUID } from 'node:crypto';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { messageText, system, user } from '#shared/llm/llm.model';
import { buildConsensusCheckPrompt, buildSynthesisPrompt, extractJsonFromResponse, parseConsensusResponse } from './debatePrompts';
import { executeToolRequests } from './debateTools';
import { freshVerificationPass } from './debateVerification';
import { createDebaters } from './debaters';
import type {
	DebateConfig,
	DebateContext,
	DebatePhase,
	DebatePosition,
	DebateResult,
	DebateRound,
	DebateState,
	DebateStreamEvent,
	DebaterConfig,
	IDebater,
	SynthesizedAnswer,
	ToolCallRecord,
} from './toolEnabledDebate';

const log = logger.child({ module: 'DebateCoordinator' });

/**
 * Event emitter type for streaming debate events
 */
export type DebateEventEmitter = (event: DebateStreamEvent) => void;

/**
 * Options for running a debate
 */
export interface RunDebateOptions {
	/** Topic/question to debate */
	topic: string;
	/** Background context (e.g., codebase info) */
	backgroundContext?: string;
	/** Debater configurations */
	debaters: DebaterConfig[];
	/** Debate configuration */
	config: DebateConfig;
	/** Optional event emitter for streaming updates */
	onEvent?: DebateEventEmitter;
}

/**
 * Main debate coordinator class
 */
export class DebateCoordinator {
	private state: DebateState;
	private debaters: IDebater[];
	private onEvent?: DebateEventEmitter;

	constructor(options: RunDebateOptions) {
		this.debaters = createDebaters(options.debaters);
		this.onEvent = options.onEvent;

		this.state = {
			debateId: randomUUID(),
			topic: options.topic,
			phase: 'initial',
			currentRound: 0,
			rounds: [],
			debaters: options.debaters,
			config: options.config,
			startTime: new Date(),
		};
	}

	/**
	 * Run the complete debate flow
	 */
	async run(): Promise<DebateResult> {
		return withActiveSpan('debate-coordinator', async () => {
			const startTime = Date.now();
			let consensusReached = false;
			let hitlInvoked = false;

			try {
				this.emit({ type: 'debate-started', debateId: this.state.debateId, topic: this.state.topic });

				// Phase 1: Generate initial positions
				this.state.phase = 'initial';
				const initialPositions = await this.generateInitialPositions();

				// Phase 2: Debate rounds until consensus or max rounds
				this.state.phase = 'debate';
				let currentPositions = initialPositions;

				while (!consensusReached && this.state.currentRound < this.state.config.maxRounds) {
					this.state.currentRound++;
					this.emit({ type: 'round-started', round: this.state.currentRound });

					const roundResult = await this.runDebateRound(currentPositions);
					this.state.rounds.push(roundResult);
					currentPositions = roundResult.positions;

					// Check consensus
					this.state.phase = 'consensus';
					consensusReached = await this.checkConsensus(currentPositions);

					this.emit({
						type: 'round-complete',
						round: this.state.currentRound,
						consensusReached,
					});
				}

				// Phase 3: HITL if no consensus and enabled
				if (!consensusReached && this.state.config.hitlEnabled) {
					this.state.phase = 'hitl';
					this.emit({ type: 'hitl-requested', reason: 'No consensus reached after maximum rounds' });

					const hitlDecision = await this.state.config.hitlHandler?.(this.state);
					hitlInvoked = true;

					if (hitlDecision?.selectedAgentId) {
						// Use the selected agent's position
						const selectedPosition = currentPositions.find((p) => p.agentId === hitlDecision.selectedAgentId);
						if (selectedPosition) {
							currentPositions = [selectedPosition];
						}
					} else if (hitlDecision?.customAnswer) {
						// Use custom answer directly
						const synthesizedAnswer: SynthesizedAnswer = {
							answer: hitlDecision.customAnswer,
							keyPoints: [],
							citations: [],
							confidence: 1.0,
						};

						this.emit({ type: 'verification-started' });
						const verifiedAnswer = await freshVerificationPass(this.state.topic, synthesizedAnswer, this.state.config.tools, this.state.config.verificationLLM);

						this.state.phase = 'complete';
						this.state.endTime = new Date();

						const result: DebateResult = {
							debateId: this.state.debateId,
							topic: this.state.topic,
							synthesizedAnswer,
							verifiedAnswer,
							rounds: this.state.rounds,
							roundCount: this.state.currentRound,
							consensusReached: false,
							hitlInvoked: true,
							executionTimeMs: Date.now() - startTime,
						};

						this.emit({ type: 'debate-complete', result });
						return result;
					}
				}

				// Phase 4: Synthesize final answer
				this.state.phase = 'synthesis';
				this.emit({ type: 'synthesis-started' });
				const synthesizedAnswer = await this.synthesizeAnswer(currentPositions);

				// Phase 5: Fresh verification pass
				this.state.phase = 'verification';
				this.emit({ type: 'verification-started' });
				const verifiedAnswer = await freshVerificationPass(this.state.topic, synthesizedAnswer, this.state.config.tools, this.state.config.verificationLLM);

				this.state.phase = 'complete';
				this.state.endTime = new Date();

				const result: DebateResult = {
					debateId: this.state.debateId,
					topic: this.state.topic,
					synthesizedAnswer,
					verifiedAnswer,
					rounds: this.state.rounds,
					roundCount: this.state.currentRound,
					consensusReached,
					hitlInvoked,
					executionTimeMs: Date.now() - startTime,
				};

				this.emit({ type: 'debate-complete', result });
				return result;
			} catch (error) {
				this.state.phase = 'error';
				this.state.error = error instanceof Error ? error.message : String(error);
				this.emit({ type: 'error', message: this.state.error });
				throw error;
			}
		});
	}

	/**
	 * Generate initial positions from all debaters in parallel
	 */
	private async generateInitialPositions(): Promise<DebatePosition[]> {
		log.info({ debateId: this.state.debateId, debaterCount: this.debaters.length }, 'Generating initial positions');

		const context = this.createContext();

		const positionPromises = this.debaters.map(async (debater) => {
			this.emit({ type: 'agent-thinking', agentId: debater.id });

			const response = await debater.generateInitialPosition(this.state.topic, context);

			const position: DebatePosition = {
				agentId: debater.id,
				position: response.position,
				confidence: response.confidence,
				reasoning: response.reasoning,
				citations: response.citations,
				codeTraces: response.codeTraces,
				toolCalls: [],
			};

			this.emit({ type: 'agent-position-complete', agentId: debater.id, position });
			return position;
		});

		return Promise.all(positionPromises);
	}

	/**
	 * Run a single debate round with sparse topology
	 */
	private async runDebateRound(currentPositions: DebatePosition[]): Promise<DebateRound> {
		log.info({ debateId: this.state.debateId, round: this.state.currentRound }, 'Running debate round');

		const allToolCalls: ToolCallRecord[] = [];
		const newPositions: DebatePosition[] = [];

		// Create context with shared tool results
		const context = this.createContext();

		// Each debater generates response based on neighbors (sparse topology)
		for (let i = 0; i < this.debaters.length; i++) {
			const debater = this.debaters[i];
			const neighborPositions = this.getNeighborPositions(currentPositions, i);

			this.emit({ type: 'agent-thinking', agentId: debater.id });

			const response = await debater.generateDebateResponse(this.state.topic, { ...context, sharedToolResults: allToolCalls }, neighborPositions);

			// Execute any tool requests
			if (response.toolRequests && response.toolRequests.length > 0) {
				const toolResults = await executeToolRequests(this.state.config.tools, response.toolRequests, debater.id);

				for (const result of toolResults) {
					allToolCalls.push(result);
					this.emit({
						type: 'agent-tool-call',
						agentId: debater.id,
						tool: result.toolName,
						params: result.parameters,
					});
					this.emit({
						type: 'agent-tool-result',
						agentId: debater.id,
						result: result.result,
					});
				}
			}

			const position: DebatePosition = {
				agentId: debater.id,
				position: response.position,
				confidence: response.confidence,
				reasoning: response.reasoning,
				citations: response.citations,
				codeTraces: response.codeTraces,
				toolCalls: allToolCalls.filter((tc) => tc.agentId === debater.id),
			};

			newPositions.push(position);
			this.emit({ type: 'agent-position-complete', agentId: debater.id, position });
		}

		return {
			round: this.state.currentRound,
			positions: newPositions,
			toolCalls: allToolCalls,
			consensusReached: false, // Will be updated by consensus check
			timestamp: new Date(),
		};
	}

	/**
	 * Get neighbor positions for sparse topology (circular)
	 * Each agent sees their own position and their immediate neighbors
	 */
	private getNeighborPositions(positions: DebatePosition[], agentIndex: number): DebatePosition[] {
		const n = positions.length;

		if (n <= 1) return [];
		if (n === 2) {
			// With 2 agents, each sees the other
			return [positions[(agentIndex + 1) % 2]];
		}

		// Circular neighbors: left and right
		const leftIndex = (agentIndex - 1 + n) % n;
		const rightIndex = (agentIndex + 1) % n;

		return [positions[leftIndex], positions[rightIndex]];
	}

	/**
	 * Check if positions have reached consensus
	 */
	private async checkConsensus(positions: DebatePosition[]): Promise<boolean> {
		log.info({ debateId: this.state.debateId, round: this.state.currentRound }, 'Checking consensus');

		const prompt = buildConsensusCheckPrompt(positions);

		const response = await this.state.config.consensusLLM.generateText(prompt, {
			id: `consensus-check-round-${this.state.currentRound}`,
			thinking: 'low',
			temperature: 0,
		});

		const { isConsistent, explanation } = parseConsensusResponse(response);

		log.info({ debateId: this.state.debateId, isConsistent, explanation }, 'Consensus check result');

		return isConsistent;
	}

	/**
	 * Synthesize the final answer from all positions
	 */
	private async synthesizeAnswer(positions: DebatePosition[]): Promise<SynthesizedAnswer> {
		log.info({ debateId: this.state.debateId, positionCount: positions.length }, 'Synthesizing final answer');

		const prompt = buildSynthesisPrompt(this.state.topic, positions);

		const response = await this.state.config.mediatorLLM.generateText(prompt, {
			id: 'debate-synthesis',
			thinking: 'high',
			temperature: 0.3,
		});

		try {
			return extractJsonFromResponse<SynthesizedAnswer>(response);
		} catch {
			// Fallback: combine positions manually
			log.warn({ debateId: this.state.debateId }, 'Failed to parse synthesis response, falling back to manual combination');

			const allCitations = positions.flatMap((p) => p.citations);
			const avgConfidence = positions.reduce((sum, p) => sum + p.confidence, 0) / positions.length;

			return {
				answer: response,
				keyPoints: positions.map((p) => ({
					agentId: p.agentId,
					points: [p.position],
				})),
				citations: allCitations,
				confidence: avgConfidence,
			};
		}
	}

	/**
	 * Create debate context
	 */
	private createContext(): DebateContext {
		return {
			topic: this.state.topic,
			backgroundContext: undefined, // Set by caller if needed
			tools: this.state.config.tools,
			round: this.state.currentRound,
			previousRounds: this.state.rounds,
			sharedToolResults: [],
		};
	}

	/**
	 * Emit a debate event
	 */
	private emit(event: DebateStreamEvent): void {
		if (this.state.config.debug) {
			log.debug({ event }, 'Debate event');
		}
		this.onEvent?.(event);
	}

	/**
	 * Get current debate state (for monitoring)
	 */
	getState(): Readonly<DebateState> {
		return this.state;
	}
}

/**
 * Run a debate with the given options
 */
export async function runDebate(options: RunDebateOptions): Promise<DebateResult> {
	const coordinator = new DebateCoordinator(options);
	return coordinator.run();
}

/**
 * Create a debate coordinator without running it
 */
export function createDebateCoordinator(options: RunDebateOptions): DebateCoordinator {
	return new DebateCoordinator(options);
}
