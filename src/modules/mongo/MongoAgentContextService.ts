import type { Collection, Db, MongoClient } from 'mongodb';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import { getCompletedHandler } from '#agent/completionHandlerRegistry';
import { functionFactory } from '#functionSchema/functionDecorators';
import { MockLLM } from '#llm/services/mock-llm';
import { logger } from '#o11y/logger'; // Assuming logger is available
import {
	AGENT_PREVIEW_KEYS, // Import this constant
	AUTONOMOUS_ITERATION_SUMMARY_KEYS, // Import this constant
	type AgentCompleted,
	type AgentContext,
	type AgentContextPreview,
	type AgentRunningState,
	type AutonomousIteration,
	type AutonomousIterationSummary,
	type FunctionCall,
	type LLM, // Ensure LLM type is available for llmData
	type LlmFunctions,
	type ToolType,
	isExecuting, // Added isExecuting
} from '#shared/agent/agent.model';
import { NotAllowed, NotFound } from '#shared/errors';
import * as userContext from '#user/userContext';

const AGENT_CONTEXT_COLLECTION = 'agentContexts';
const AGENT_ITERATIONS_COLLECTION = 'agentIterations';

// Helper to prepare AgentContext for MongoDB storage
function agentContextToDbDoc(context: AgentContext): any {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { agentId, fileSystem, functions, completedHandler, ...rest } = context;
	const doc: any = {
		_id: agentId, // Use agentId as MongoDB's _id
		...rest,
		functions: functions.toJSON(), // Stores { functionClasses: string[] }
		lastUpdate: Date.now(),
	};
	if (completedHandler) {
		doc.completedHandlerId = completedHandler.agentCompletedHandlerId();
	}
	// Ensure metadata is at least an empty object if undefined
	doc.metadata = context.metadata ?? {};
	return doc;
}

// Helper to convert MongoDB doc back to AgentContext
function dbDocToAgentContext(doc: any): AgentContext | null {
	if (!doc) return null;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { _id, functions: functionsData, completedHandlerId, ...rest } = doc;

	const llmFunctionsInstance = new LlmFunctionsImpl(); // Create instance
	if (functionsData) {
		llmFunctionsInstance.fromJSON(functionsData); // Call instance method
	}

	let rehydratedCompletedHandler: AgentCompleted | undefined = undefined;
	if (doc.completedHandlerId) {
		rehydratedCompletedHandler = getCompletedHandler(doc.completedHandlerId);
		if (!rehydratedCompletedHandler) {
			logger.warn(`Completed handler with ID ${doc.completedHandlerId} not found in registry during agent load.`);
		}
	}

	const context: AgentContext = {
		agentId: _id,
		...rest, // llms will be part of rest initially
		functions: llmFunctionsInstance, // Use the populated instance
		fileSystem: null, // fileSystem is a runtime concern, not persisted.
		completedHandler: rehydratedCompletedHandler,
	};

	// Rehydrate LLMs, specifically MockLLM
	if (context.llms) {
		for (const key in context.llms) {
			if (Object.prototype.hasOwnProperty.call(context.llms, key)) {
				// Assert llmData to a type that includes the properties expected from serialized data
				const llmData = context.llms[key] as {
					id: string;
					service: string;
					model?: string;
					config?: any; // Keep config for now for other LLMs, though MockLLM won't use it directly
					responses?: { response: string; callback?: (prompt: string) => void }[];
					/* other potential BaseLLM/LLM fields */
				};
				// The requirement specifies llmData.provider. The LLM interface has 'service'.
				// Assuming 'provider' in requirement maps to 'service'.
				if (llmData && llmData.service === 'mock') {
					// Requirement: new MockLLM(llmData.id, llmData.provider, llmData.config)
					// Using llmData.service for provider as per LLM interface.
					context.llms[key] = new MockLLM(
						llmData.id,
						llmData.service,
						llmData.model ?? 'mock',
						undefined /* for maxInputTokens, let constructor default kick in */,
						llmData.responses,
					);
				}
			}
		}
	}

	return context;
}

export class MongoAgentContextService implements AgentContextService {
	private agentContextsCollection: Collection<any>;
	private agentIterationsCollection: Collection<AutonomousIteration>;

	constructor(
		private db: Db,
		private client: MongoClient,
	) {
		this.agentContextsCollection = this.db.collection(AGENT_CONTEXT_COLLECTION);
		this.agentIterationsCollection = this.db.collection<AutonomousIteration>(AGENT_ITERATIONS_COLLECTION);
	}

	async save(state: AgentContext): Promise<void> {
		try {
			// Handle parent agent relationship
			if (state.parentAgentId) {
				const parentDoc = await this.agentContextsCollection.findOne({ _id: state.parentAgentId });

				if (!parentDoc) {
					throw new NotFound(`Parent agent with ID ${state.parentAgentId} not found when attempting to save child agent ${state.agentId}.`);
				}

				await this.agentContextsCollection.updateOne({ _id: state.parentAgentId }, { $addToSet: { childAgents: state.agentId } });
			}

			// Save current agent's state
			const doc = agentContextToDbDoc(state);
			await this.agentContextsCollection.updateOne({ _id: state.agentId }, { $set: doc }, { upsert: true });
		} catch (error) {
			logger.error(error, `Failed to save agent context [agentId=${state.agentId}]`);
			throw error;
		}
	}

	async updateState(ctx: AgentContext, state: AgentRunningState): Promise<void> {
		try {
			const updateTime = Date.now(); // Use a consistent timestamp
			const result = await this.agentContextsCollection.updateOne({ _id: ctx.agentId }, { $set: { state: state, lastUpdate: updateTime } });
			if (result.matchedCount === 0) {
				logger.warn(`Agent context not found for state update [agentId=${ctx.agentId}]`);
				// Optionally throw an error if agent must exist
				// throw new Error(`Agent with ID ${ctx.agentId} not found for state update.`);
			} else {
				// Mutate the context object in memory
				ctx.state = state;
				ctx.lastUpdate = updateTime;
			}
		} catch (error) {
			logger.error(error, `Failed to update agent state [agentId=${ctx.agentId}]`);
			throw error;
		}
	}

	async load(agentId: string): Promise<AgentContext> {
		try {
			const doc = await this.agentContextsCollection.findOne({ _id: agentId });
			if (!doc) {
				throw new NotFound(`Agent with ID ${agentId} not found`);
			}

			// User ownership check
			const currentUserId = userContext.currentUser().id;
			if (doc.user?.id !== currentUserId) {
				// Ensure doc.user and doc.user.id exist
				throw new NotAllowed(`User not authorized to access agent ${agentId}`);
			}

			return dbDocToAgentContext(doc) as AgentContext;
		} catch (error) {
			// Avoid double logging if NotAllowed or NotFound is thrown from above
			if (!(error instanceof NotFound) && !(error instanceof NotAllowed)) {
				logger.error(error, `Failed to load agent context [agentId=${agentId}]`);
			}
			throw error;
		}
	}

	async requestHumanInLoopCheck(agent: AgentContext): Promise<void> {
		try {
			const result = await this.agentContextsCollection.updateOne({ _id: agent.agentId }, { $set: { hilRequested: true, lastUpdate: Date.now() } });
			if (result.matchedCount === 0) {
				logger.warn(`Agent context not found for HIL request [agentId=${agent.agentId}]`);
				// Optionally throw an error
				// throw new Error(`Agent with ID ${agent.agentId} not found for HIL request.`);
			}
		} catch (error) {
			logger.error(error, `Failed to request human-in-loop for agent [agentId=${agent.agentId}]`);
			throw error;
		}
	}

	async list(): Promise<AgentContextPreview[]> {
		try {
			const currentUserId = userContext.currentUser().id; // Get current user ID

			const projection: Record<string, 0 | 1> = { _id: 0 }; // Exclude MongoDB's _id by default
			(AGENT_PREVIEW_KEYS as unknown as Array<keyof AgentContext | '_id'>).forEach((key) => {
				if (key === 'agentId') {
					projection._id = 1; // Map agentId to _id for retrieval
				} else {
					projection[key as string] = 1;
				}
			});

			// Filter by user.id
			const docs = await this.agentContextsCollection.find({ 'user.id': currentUserId }).sort({ lastUpdate: -1 }).project(projection).toArray();
			return docs.map((doc) => {
				const preview = { ...doc } as any;
				if (doc._id) {
					preview.agentId = doc._id; // Map _id back to agentId
					preview._id = undefined;
				}
				return preview as AgentContextPreview;
			});
		} catch (error) {
			logger.error(error, 'Failed to list agent contexts');
			throw error;
		}
	}

	async listRunning(): Promise<AgentContextPreview[]> {
		try {
			const currentUserId = userContext.currentUser().id; // Get current user ID
			const terminalStates: AgentRunningState[] = ['completed', 'error', 'shutdown', 'timeout'];

			const projection: Record<string, 0 | 1> = { _id: 0 };
			(AGENT_PREVIEW_KEYS as unknown as Array<keyof AgentContext | '_id'>).forEach((key) => {
				if (key === 'agentId') {
					projection._id = 1;
				} else {
					projection[key as string] = 1;
				}
			});

			// Filter by user.id and state
			const docs = await this.agentContextsCollection
				.find({ 'user.id': currentUserId, state: { $nin: terminalStates } })
				.sort({ state: 1, lastUpdate: -1 })
				.project(projection)
				.toArray();

			return docs.map((doc) => {
				const preview = { ...doc } as any;
				if (doc._id) {
					preview.agentId = doc._id;
					preview._id = undefined;
				}
				return preview as AgentContextPreview;
			});
		} catch (error) {
			logger.error(error, 'Failed to list running agent contexts');
			throw error;
		}
	}

	/**
	 * Clears all agent contexts and iterations.
	 * IMPORTANT: This method is synchronous (returns void) as per the interface.
	 * DB operations are async; thus, this is a fire-and-forget operation.
	 * Errors will be logged but not propagated to the caller.
	 */
	clear(): void {
		this.agentContextsCollection.deleteMany({}).catch((err) => logger.error(err, 'Failed to clear agentContexts collection'));
		this.agentIterationsCollection.deleteMany({}).catch((err) => logger.error(err, 'Failed to clear agentIterations collection'));
		logger.info('Clear operation initiated for agent contexts and iterations (fire-and-forget).');
	}

	async delete(ids: string[]): Promise<void> {
		if (!ids || ids.length === 0) {
			return;
		}

		const session = this.client.startSession();

		try {
			await session.withTransaction(async (sess) => {
				const agentIdsToDelete = new Set<string>();
				let currentUserId: string;

				// This is the beginning of the existing try...catch logic, now inside the transaction
				try {
					currentUserId = userContext.currentUser().id;

					for (const id of ids) {
						// Requirement 1: Log processing start
						logger.info(`Processing delete for id: ${id}`);

						// Requirement 2: Log before findOne
						logger.info(`Calling findOne for id: ${id}`);
						// Pass the session to the findOne operation
						const agentDoc = await this.agentContextsCollection.findOne({ _id: id }, { session: sess });

						// Requirement 3: Log after findOne
						if (agentDoc) {
							logger.info(`Found agentDoc for id: ${id}, state: ${agentDoc.state}, parentId: ${agentDoc.parentAgentId}, user.id: ${agentDoc.user?.id}`);
						} else {
							logger.info(`No agentDoc found for id: ${id}`);
						}

						if (!agentDoc) {
							logger.warn(`Agent ${id} not found during delete operation.`);
							continue;
						}

						// Requirement 4: Log ownership check
						logger.info(`Checking ownership for id: ${id}. DocUser: ${agentDoc.user?.id}, CurrentUser: ${currentUserId}`);
						// User ownership check
						if (agentDoc.user?.id !== currentUserId) {
							logger.warn(`User ${currentUserId} attempting to delete agent ${id} owned by ${agentDoc.user?.id}. Skipping.`);
							// Requirement 4: Log skip due to ownership
							logger.info(`Skipping id ${id} due to ownership mismatch.`);
							continue;
						}

						// Requirement 5: Log before dbDocToAgentContext
						logger.info(`Converting agentDoc to temporaryAgentContext for id: ${id}`);
						const temporaryAgentContext = dbDocToAgentContext(agentDoc);
						if (!temporaryAgentContext) {
							logger.warn(`Agent ${id} could not be converted to a temporary context for state check during delete. Skipping deletion.`);
							continue;
						}

						// Requirement 6: Log before isExecuting check
						logger.info(`Checking isExecuting for id: ${id}. State: ${temporaryAgentContext.state}`);
						// Check if agent is executing
						if (isExecuting(temporaryAgentContext)) {
							logger.warn(`Agent ${id} is in an executing state (${agentDoc.state}). Skipping deletion.`);
							// Requirement 6: Log skip due to executing state
							logger.info(`Skipping id ${id} because it is executing. State: ${temporaryAgentContext.state}`);
							continue;
						}

						// Requirement 7: Log before child agent check
						logger.info(`Checking if id ${id} is a child agent. ParentId: ${agentDoc.parentAgentId}`);
						// Check if it's a child agent
						if (agentDoc.parentAgentId) {
							logger.warn(`Agent ${id} is a child agent. Skipping direct deletion. It will be deleted if its parent is deleted.`);
							// Requirement 7: Log skip due to being a child agent
							logger.info(`Skipping id ${id} because it is a child agent (ParentId: ${agentDoc.parentAgentId}) and direct deletion of children is skipped.`);
							continue;
						}

						// Requirement 8: Log before adding to agentIdsToDelete
						logger.info(`Adding id ${agentDoc._id} to agentIdsToDelete.`);
						agentIdsToDelete.add(agentDoc._id);

						if (agentDoc.childAgents && agentDoc.childAgents.length > 0) {
							for (const childId of agentDoc.childAgents) {
								agentIdsToDelete.add(childId);
							}
						}
					}

					// Requirement 9: Log final agentIdsToDelete set
					logger.info(`Final agentIdsToDelete (before converting to finalIds): ${JSON.stringify(Array.from(agentIdsToDelete))}`);

					const finalIds = Array.from(agentIdsToDelete);

					if (finalIds.length > 0) {
						logger.info(`Attempting to delete agentContexts with IDs: ${JSON.stringify(finalIds)}`);
						// Pass the session to the deleteMany operation
						const contextDeleteResult = await this.agentContextsCollection.deleteMany({ _id: { $in: finalIds } }, { session: sess });
						logger.info(`AgentContexts deleteMany result: deletedCount=${contextDeleteResult.deletedCount}, acknowledged=${contextDeleteResult.acknowledged}`);

						logger.info(`Attempting to delete agentIterations for agent IDs: ${JSON.stringify(finalIds)}`);
						// Pass the session to the deleteMany operation
						const iterationDeleteResult = await this.agentIterationsCollection.deleteMany({ agentId: { $in: finalIds } }, { session: sess });
						logger.info(
							`AgentIterations deleteMany result: deletedCount=${iterationDeleteResult.deletedCount}, acknowledged=${iterationDeleteResult.acknowledged}`,
						);

						if (contextDeleteResult.acknowledged && iterationDeleteResult.acknowledged) {
							logger.info(
								`Delete operations acknowledged for agent IDs: ${finalIds.join(', ')}. Contexts deleted: ${contextDeleteResult.deletedCount}, Iterations deleted: ${iterationDeleteResult.deletedCount}`,
							);
						} else {
							logger.warn(
								`Delete operations might not have been fully acknowledged for agent IDs: ${finalIds.join(', ')}. Contexts acknowledged: ${contextDeleteResult.acknowledged}, Iterations acknowledged: ${iterationDeleteResult.acknowledged}`,
							);
						}
					} else {
						logger.info('No agent IDs in finalIds, skipping deleteMany operations.');
						return; // Return from the async lambda passed to withTransaction
					}
				} catch (error) {
					// This is the existing catch block, now inside the transaction
					// Log the error. If this error is thrown, withTransaction will abort the transaction.
					logger.error(error, `Failed to delete agent contexts/iterations for IDs [ids=${ids.join(',')}]`);
					throw error; // Re-throw to ensure transaction aborts and error propagates
				}
			}); // End of session.withTransaction
		} catch (transactionError) {
			// This catch block handles errors from session.startSession(),
			// errors from session.withTransaction() itself (e.g., transaction commit errors not caught and re-thrown from inside),
			// or errors from session.endSession() if it were inside this try block (it's in finally).
			logger.error(transactionError, `Transactional delete operation failed for IDs [ids=${ids.join(',')}]`);
			throw transactionError; // Re-throw so the caller is aware of the failure
		} finally {
			await session.endSession(); // Ensure the session is always closed
		}
	}

	async updateFunctions(agentId: string, functions: string[]): Promise<void> {
		try {
			await this.load(agentId); // Ensures agent exists and user has access

			// Store as { functionClasses: string[] } to be compatible with LlmFunctions.toJSON/fromJSON
			const functionsData = { functionClasses: functions };
			const result = await this.agentContextsCollection.updateOne({ _id: agentId }, { $set: { functions: functionsData, lastUpdate: Date.now() } });

			// The this.load(agentId) call above handles the primary existence/ownership check.
			// This matchedCount check can remain as a secondary guard or for specific scenarios
			// where the agent might be deleted between the load and updateOne calls, though unlikely.
			if (result.matchedCount === 0) {
				// This case should ideally not be hit if this.load(agentId) passed,
				// unless the agent was deleted concurrently.
				logger.warn(`Agent context not found for functions update despite prior load [agentId=${agentId}]`);
				// throw new NotFound(`Agent with ID ${agentId} not found for functions update.`); // Or handle as appropriate
			}
		} catch (error) {
			// Avoid double logging if error is from this.load()
			if (!(error instanceof NotFound) && !(error instanceof NotAllowed)) {
				logger.error(error, `Failed to update functions for agent [agentId=${agentId}]`);
			}
			throw error;
		}
	}

	async saveIteration(iterationData: AutonomousIteration): Promise<void> {
		// Validate iteration number
		if (iterationData.iteration == null || iterationData.iteration <= 0) {
			throw new Error('Iteration number must be a positive integer and greater than 0.');
		}

		try {
			// Ensure memory and toolState are objects, not Maps, as per AutonomousIteration model
			iterationData.memory = iterationData.memory ?? {};
			iterationData.toolState = iterationData.toolState ?? {};
			await this.agentIterationsCollection.insertOne(iterationData);
		} catch (error) {
			logger.error(error, `Failed to save agent iteration [agentId=${iterationData.agentId}, iteration=${iterationData.iteration}]`);
			throw error;
		}
	}

	async loadIterations(agentId: string): Promise<AutonomousIteration[]> {
		try {
			await this.load(agentId); // Ensures agent exists and user has access

			const docs = await this.agentIterationsCollection.find({ agentId: agentId }).sort({ iteration: 1 }).toArray();

			// Normalize fields
			return docs.map((iterDoc) => {
				const normalizedDoc = { ...iterDoc };
				if (normalizedDoc.draftCode === null) normalizedDoc.draftCode = undefined;
				if (normalizedDoc.codeReview === null) normalizedDoc.codeReview = undefined;
				if (normalizedDoc.error === null) normalizedDoc.error = undefined;
				return normalizedDoc as AutonomousIteration;
			});
		} catch (error) {
			// Avoid double logging if error is from this.load()
			if (!(error instanceof NotFound) && !(error instanceof NotAllowed)) {
				logger.error(error, `Failed to load iterations for agent [agentId=${agentId}]`);
			}
			throw error;
		}
	}

	async getAgentIterationSummaries(agentId: string): Promise<AutonomousIterationSummary[]> {
		try {
			await this.load(agentId); // Ensures agent exists and user has access

			const projection: Record<string, 1> = {};
			(AUTONOMOUS_ITERATION_SUMMARY_KEYS as unknown as (keyof AutonomousIteration)[]).forEach((key) => {
				projection[key as string] = 1;
			});

			const docs = await this.agentIterationsCollection.find({ agentId: agentId }).sort({ iteration: 1 }).project(projection).toArray();
			return docs as AutonomousIterationSummary[];
		} catch (error) {
			// Avoid double logging if error is from this.load()
			if (!(error instanceof NotFound) && !(error instanceof NotAllowed)) {
				logger.error(error, `Failed to get agent iteration summaries [agentId=${agentId}]`);
			}
			throw error;
		}
	}

	async getAgentIterationDetail(agentId: string, iterationNumber: number): Promise<AutonomousIteration | null> {
		try {
			await this.load(agentId); // Ensures agent exists and user has access

			const iteration = await this.agentIterationsCollection.findOne({
				agentId: agentId,
				iteration: iterationNumber,
			});

			if (!iteration) {
				// Specific NotFound for the iteration itself
				throw new NotFound(`Iteration ${iterationNumber} not found for agent ${agentId}`);
			}

			// Normalize fields
			const normalizedIteration = { ...iteration };
			if (normalizedIteration.draftCode === null) normalizedIteration.draftCode = undefined;
			if (normalizedIteration.codeReview === null) normalizedIteration.codeReview = undefined;
			if (normalizedIteration.error === null) normalizedIteration.error = undefined;

			return normalizedIteration as AutonomousIteration;
		} catch (error) {
			// Avoid double logging if error is from this.load() or the new NotFound
			if (!(error instanceof NotFound) && !(error instanceof NotAllowed)) {
				logger.error(error, `Failed to get agent iteration detail [agentId=${agentId}, iteration=${iterationNumber}]`);
			}
			throw error;
		}
	}
}
