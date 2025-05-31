import {
	type AgentContext,
	type AgentContextPreview,
	type AgentRunningState,
	type AutonomousIteration,
	type AutonomousIterationSummary,
	type LlmFunctions,
	AGENT_PREVIEW_KEYS, // Import this constant
	AUTONOMOUS_ITERATION_SUMMARY_KEYS, // Import this constant
	type ToolType, // Potentially needed for DefaultLlmFunctions if it's defined here
	type FunctionCall, // Potentially needed for DefaultLlmFunctions
} from '#shared/agent/agent.model';
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import { Collection, Db } from 'mongodb';
import { logger } from '#o11y/logger'; // Assuming logger is available

const AGENT_CONTEXT_COLLECTION = 'agentContexts';
const AGENT_ITERATIONS_COLLECTION = 'agentIterations';

// Placeholder for a concrete LlmFunctions implementation.
// This class would typically be imported from a shared module.
// It needs to implement the LlmFunctions interface and handle
// instantiation of actual function classes based on names.
class DefaultLlmFunctions implements LlmFunctions {
	private functionClassNames: string[] = [];
	// In a real scenario, this would need a registry to instantiate functions by name.
	// For this design, we'll keep it simple.

	constructor() {
		// Initialization, possibly with a function registry
	}

	toJSON(): { functionClasses: string[] } {
		return { functionClasses: this.functionClassNames };
	}

	fromJSON(obj: any): this {
		if (obj && Array.isArray(obj.functionClasses)) {
			this.functionClassNames = [...obj.functionClasses];
			// A real implementation would iterate through functionClassNames
			// and instantiate/register the corresponding function tools.
		}
		return this;
	}

	removeFunctionClass(functionClassName: string): void {
		this.functionClassNames = this.functionClassNames.filter((name) => name !== functionClassName);
	}

	getFunctionInstances(): object[] {
		// This would return actual instantiated function objects.
		logger.warn('DefaultLlmFunctions.getFunctionInstances() is a stub');
		return [];
	}

	getFunctionInstanceMap(): Record<string, object> {
		logger.warn('DefaultLlmFunctions.getFunctionInstanceMap() is a stub');
		return {};
	}

	getFunctionClassNames(): string[] {
		return [...this.functionClassNames];
	}

	getFunctionType(type: ToolType): any {
		logger.warn('DefaultLlmFunctions.getFunctionType() is a stub');
		return undefined;
	}

	addFunctionInstance(functionClassInstance: object, name: string): void {
		// This would add an already instantiated function.
		// For simplicity, we'll just track its conceptual presence by name if possible.
		if (!this.functionClassNames.includes(name)) {
			this.functionClassNames.push(name); // Or derive name from instance
		}
	}

	addFunctionClass(...functionClasses: Array<new () => any>): void {
		functionClasses.forEach((cls) => {
			if (!this.functionClassNames.includes(cls.name)) {
				this.functionClassNames.push(cls.name);
			}
		});
	}

	async callFunction(functionCall: FunctionCall): Promise<any> {
		logger.warn('DefaultLlmFunctions.callFunction() is a stub');
		throw new Error(`Function ${functionCall.function_name} not found or callable in this stub.`);
	}
}

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

	const llmFunctions = new DefaultLlmFunctions();
	if (functionsData) {
		llmFunctions.fromJSON(functionsData);
	}

	// The actual AgentCompleted instance is not rehydrated here.
	// The AgentContext will have `completedHandler: undefined`.
	// The component using the loaded AgentContext is responsible for
	// re-associating the handler if `completedHandlerId` (available in `doc.completedHandlerId`) is present.
	const context: AgentContext = {
		agentId: _id,
		...rest,
		functions: llmFunctions,
		fileSystem: null, // fileSystem is a runtime concern, not persisted.
		completedHandler: undefined, // To be re-associated by consumer using doc.completedHandlerId
	};
	return context;
}

export class MongoAgentContextService implements AgentContextService {
	private agentContextsCollection: Collection<any>;
	private agentIterationsCollection: Collection<AutonomousIteration>;

	constructor(private db: Db) {
		this.agentContextsCollection = this.db.collection(AGENT_CONTEXT_COLLECTION);
		this.agentIterationsCollection = this.db.collection<AutonomousIteration>(AGENT_ITERATIONS_COLLECTION);
	}

	async save(state: AgentContext): Promise<void> {
		const doc = agentContextToDbDoc(state);
		try {
			await this.agentContextsCollection.updateOne({ _id: state.agentId }, { $set: doc }, { upsert: true });
		} catch (error) {
			logger.error(error, `Failed to save agent context [agentId=${state.agentId}]`);
			throw error;
		}
	}

	async updateState(ctx: AgentContext, state: AgentRunningState): Promise<void> {
		try {
			const result = await this.agentContextsCollection.updateOne(
				{ _id: ctx.agentId },
				{ $set: { state: state, lastUpdate: Date.now() } },
			);
			if (result.matchedCount === 0) {
				logger.warn(`Agent context not found for state update [agentId=${ctx.agentId}]`);
				// Optionally throw an error if agent must exist
				// throw new Error(`Agent with ID ${ctx.agentId} not found for state update.`);
			}
		} catch (error) {
			logger.error(error, `Failed to update agent state [agentId=${ctx.agentId}]`);
			throw error;
		}
	}

	async load(agentId: string): Promise<AgentContext | null> {
		try {
			const doc = await this.agentContextsCollection.findOne({ _id: agentId });
			return dbDocToAgentContext(doc);
		} catch (error) {
			logger.error(error, `Failed to load agent context [agentId=${agentId}]`);
			throw error;
		}
	}

	async requestHumanInLoopCheck(agent: AgentContext): Promise<void> {
		try {
			const result = await this.agentContextsCollection.updateOne(
				{ _id: agent.agentId },
				{ $set: { hilRequested: true, lastUpdate: Date.now() } },
			);
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
			const projection: Record<string, 0 | 1> = { _id: 0 }; // Exclude MongoDB's _id by default
			(AGENT_PREVIEW_KEYS as unknown as Array<keyof AgentContext | '_id'>).forEach((key) => {
				if (key === 'agentId') {
					projection['_id'] = 1; // Map agentId to _id for retrieval
				} else {
					projection[key as string] = 1;
				}
			});

			const docs = await this.agentContextsCollection.find({}).project(projection).toArray();
			return docs.map((doc) => {
				const preview = { ...doc } as any;
				if (doc._id) {
					preview.agentId = doc._id; // Map _id back to agentId
					delete preview._id;
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
			// const runningStates: AgentRunningState[] = ['workflow', 'agent', 'functions', 'hitl_tool'];
			// Or, more broadly, not in a terminal state:
			const terminalStates: AgentRunningState[] = ['completed', 'error', 'shutdown', 'timeout'];

			const projection: Record<string, 0 | 1> = { _id: 0 };
			(AGENT_PREVIEW_KEYS as unknown as Array<keyof AgentContext | '_id'>).forEach((key) => {
				if (key === 'agentId') {
					projection['_id'] = 1;
				} else {
					projection[key as string] = 1;
				}
			});

			const docs = await this.agentContextsCollection
				.find({ state: { $nin: terminalStates } })
				.project(projection)
				.toArray();

			return docs.map((doc) => {
				const preview = { ...doc } as any;
				if (doc._id) {
					preview.agentId = doc._id;
					delete preview._id;
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
		if (!ids || ids.length === 0) return;
		try {
			const deleteAgentContextsPromise = this.agentContextsCollection.deleteMany({ _id: { $in: ids } });
			const deleteAgentIterationsPromise = this.agentIterationsCollection.deleteMany({ agentId: { $in: ids } });
			await Promise.all([deleteAgentContextsPromise, deleteAgentIterationsPromise]);
		} catch (error) {
			logger.error(error, `Failed to delete agent contexts/iterations for IDs [ids=${ids.join(',')}]`);
			throw error;
		}
	}

	async updateFunctions(agentId: string, functions: string[]): Promise<void> {
		try {
			// Store as { functionClasses: string[] } to be compatible with LlmFunctions.toJSON/fromJSON
			const functionsData = { functionClasses: functions };
			const result = await this.agentContextsCollection.updateOne(
				{ _id: agentId },
				{ $set: { functions: functionsData, lastUpdate: Date.now() } },
			);
			if (result.matchedCount === 0) {
				logger.warn(`Agent context not found for functions update [agentId=${agentId}]`);
				// Optionally throw: throw new Error(`Agent with ID ${agentId} not found for functions update.`);
			}
		} catch (error) {
			logger.error(error, `Failed to update functions for agent [agentId=${agentId}]`);
			throw error;
		}
	}

	async saveIteration(iterationData: AutonomousIteration): Promise<void> {
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
			return await this.agentIterationsCollection.find({ agentId: agentId }).sort({ iteration: 1 }).toArray();
		} catch (error) {
			logger.error(error, `Failed to load iterations for agent [agentId=${agentId}]`);
			throw error;
		}
	}

	async getAgentIterationSummaries(agentId: string): Promise<AutonomousIterationSummary[]> {
		try {
			const projection: Record<string, 1> = {};
			(AUTONOMOUS_ITERATION_SUMMARY_KEYS as unknown as (keyof AutonomousIteration)[]).forEach((key) => {
				projection[key as string] = 1;
			});

			const docs = await this.agentIterationsCollection
				.find({ agentId: agentId })
				.sort({ iteration: 1 })
				.project(projection)
				.toArray();
			return docs as AutonomousIterationSummary[];
		} catch (error) {
			logger.error(error, `Failed to get agent iteration summaries [agentId=${agentId}]`);
			throw error;
		}
	}

	async getAgentIterationDetail(agentId: string, iterationNumber: number): Promise<AutonomousIteration | null> {
		try {
			const iteration = await this.agentIterationsCollection.findOne({
				agentId: agentId,
				iteration: iterationNumber,
			});
			return iteration || null;
		} catch (error) {
			logger.error(error, `Failed to get agent iteration detail [agentId=${agentId}, iteration=${iterationNumber}]`);
			throw error;
		}
	}
}
