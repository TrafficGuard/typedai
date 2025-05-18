import type { DocumentSnapshot, Firestore } from '@google-cloud/firestore';
import type { Static } from '@sinclair/typebox';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import { deserializeContext, serializeContext } from '#agent/agentSerialization';
import { MAX_PROPERTY_SIZE, truncateToByteLength, validateFirestoreObject } from '#firestore/firestoreUtils';
import { functionFactory } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { type AgentContext, type AgentRunningState, type AutonomousIteration, isExecuting } from '#shared/model/agent.model';
import type { User } from '#shared/model/user.model';
import type { AgentContextSchema } from '#shared/schemas/agent.schema';
import { currentUser } from '#user/userContext';
import { firestoreDb } from './firestore';

// Type specifically for Firestore storage, allowing objects for Maps
type FirestoreAutonomousIteration = Omit<AutonomousIteration, 'memory' | 'toolState'> & {
	memory: Record<string, string>;
	toolState: Record<string, any>;
};

/**
 * Google Firestore implementation of AgentStateService
 */
export class FirestoreAgentStateService implements AgentContextService {
	db: Firestore = firestoreDb();

	@span()
	async save(state: AgentContext): Promise<void> {
		if (state.error && Buffer.byteLength(state.error, 'utf8') > MAX_PROPERTY_SIZE / 2) {
			state.error = truncateToByteLength(state.error, MAX_PROPERTY_SIZE / 2);
		}
		if (Buffer.byteLength(state.inputPrompt, 'utf8') > MAX_PROPERTY_SIZE) {
			// Log instead of throwing, as per original code, but maybe consider throwing if this is critical
			logger.warn({ agentId: state.agentId }, `Input prompt is greater than ${MAX_PROPERTY_SIZE} bytes and might be truncated by Firestore`);
		}
		const serialized = serializeContext(state);
		serialized.lastUpdate = Date.now();

		// Add this validation step
		try {
			validateFirestoreObject(serialized);
		} catch (error) {
			logger.error({ agentId: state.agentId, error: error.message }, 'Firestore validation failed before saving AgentContext.');
			// Optionally re-throw or handle the error appropriately
			throw new Error(`Firestore validation failed for agent ${state.agentId}: ${error.message}`);
		}

		const docRef = this.db.doc(`AgentContext/${state.agentId}`);

		if (state.parentAgentId) {
			await this.db.runTransaction(async (transaction) => {
				// Get the parent agent
				const parentDocRef = this.db.doc(`AgentContext/${state.parentAgentId}`);
				const parentDoc = await transaction.get(parentDocRef);

				if (!parentDoc.exists) throw new Error(`Parent agent ${state.parentAgentId} not found`);

				const parentData = parentDoc.data();
				const childAgents = new Set(parentData.childAgents || []);

				// Add child to parent if not already present
				if (!childAgents.has(state.agentId)) {
					childAgents.add(state.agentId);
					transaction.update(parentDocRef, {
						childAgents: Array.from(childAgents),
						lastUpdate: Date.now(),
					});
				}

				// Save the child agent state
				transaction.set(docRef, serialized);
			});
		} else {
			try {
				await docRef.set(serialized);
			} catch (error) {
				logger.error(error, 'Error saving agent state');
				throw error;
			}
		}
	}

	async updateState(ctx: AgentContext, state: AgentRunningState): Promise<void> {
		const now = Date.now();

		const docRef = this.db.doc(`AgentContext/${ctx.agentId}`);
		try {
			// Update only the state and lastUpdate fields in Firestore for efficiency
			await docRef.update({
				state: state,
				lastUpdate: now,
			});
			// Update the state in the context object provided directly for immediate consistency once the firestore update completes
			ctx.state = state;
			ctx.lastUpdate = now;
		} catch (error) {
			logger.error(error, `Error updating state for agent ${ctx.agentId} to ${state}`);
			throw error;
		}
	}

	async requestHumanInLoopCheck(agent: AgentContext): Promise<void> {
		const now = Date.now();

		const docRef = this.db.doc(`AgentContext/${agent.agentId}`);
		try {
			const update: Partial<AgentContext> = {
				hilRequested: true,
				lastUpdate: now,
			};
			await docRef.update(update);
			// Update the state in the context object provided directly for immediate consistency once the firestore update completes
			agent.hilRequested = true;
			agent.lastUpdate = now;
		} catch (error) {
			logger.error(error, `Error setting hilRequested for agent ${agent.agentId}`);
			throw error;
		}
	}

	@span({ agentId: 0 })
	async load(agentId: string): Promise<AgentContext | null> {
		const docRef = this.db.doc(`AgentContext/${agentId}`);
		const docSnap: DocumentSnapshot = await docRef.get();
		if (!docSnap.exists) {
			return null;
		}
		const firestoreData = docSnap.data();
		if (!firestoreData) {
			logger.warn({ agentId }, 'Firestore document exists but data is undefined during agent context load.');
			return null;
		}

		// Construct the object ensuring it aligns with AgentContextSchema.
		// AgentContextSchema is designed to include all fields needed by the new deserializeContext.
		// The new deserializeContext handles defaults for many fields.
		const schemaCompliantData = {
			...firestoreData, // Spread all data from Firestore
			agentId: agentId, // Ensure agentId is present from the method parameter
		} as Static<typeof AgentContextSchema>; // Cast to the schema type.

		return deserializeContext(schemaCompliantData); // Use the NEW synchronous deserializeContext
	}

	@span()
	async list(): Promise<AgentContext[]> {
		// TODO limit the fields retrieved for performance, esp while functionCallHistory and memory is on the AgentContext object
		const keys: Array<keyof AgentContext> = ['agentId', 'name', 'state', 'cost', 'error', 'lastUpdate', 'userPrompt', 'inputPrompt', 'user'];
		const querySnapshot = await this.db
			.collection('AgentContext')
			.where('user', '==', currentUser().id)
			.select(...keys)
			.orderBy('lastUpdate', 'desc')
			.get();
		return this.deserializeQuery(querySnapshot);
	}

	@span()
	async listRunning(): Promise<AgentContext[]> {
		// Define terminal states to exclude from the "running" list
		const terminalStates: AgentRunningState[] = ['completed', 'shutdown', 'timeout', 'error']; // Added 'error' as it's typically terminal
		// NOTE: This query requires a composite index in Firestore.
		// Example gcloud command:
		// gcloud firestore indexes composite create --collection-group=AgentContext --query-scope=COLLECTION --field-config field-path=user,order=ASCENDING --field-config field-path=state,operator=NOT_IN --field-config field-path=lastUpdate,order=DESCENDING
		// Firestore usually guides index creation in the console based on query errors.
		// NOTE: Firestore requires the first orderBy clause to be on the field used in an inequality filter (like 'not-in').
		// Therefore, we order by 'state' first, then by 'lastUpdate'. This ensures the query works reliably,
		// although the primary desired sort order is by 'lastUpdate'.
		const querySnapshot = await this.db
			.collection('AgentContext')
			.where('user', '==', currentUser().id) // Filter by user first
			.where('state', 'not-in', terminalStates) // Use 'not-in' to exclude multiple terminal states
			.orderBy('state') // Order by the inequality filter field first (Firestore requirement)
			.orderBy('lastUpdate', 'desc') // Then order by the desired field
			.get();
		return this.deserializeQuery(querySnapshot);
	}

	private async deserializeQuery(querySnapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData, FirebaseFirestore.DocumentData>) {
		const contexts: Partial<AgentContext>[] = []; // Use Partial<AgentContext> for list view summary
		for (const doc of querySnapshot.docs) {
			const data = doc.data();
			// Construct a partial context suitable for list views
			const partialContext: Partial<AgentContext> = {
				agentId: doc.id,
				name: data.name,
				state: data.state,
				cost: data.cost,
				error: data.error,
				lastUpdate: data.lastUpdate,
				userPrompt: data.userPrompt,
				inputPrompt: data.inputPrompt,
				// Assign the user ID stored in Firestore. Assume it's stored as a string ID.
				// Create a minimal User object containing only the ID for type compatibility.
				user: data.user ? ({ id: data.user } as User) : undefined,
			};
			contexts.push(partialContext);
		}
		// Cast to AgentContext[] for compatibility with current method signature.
		// Consumers of list() / listRunning() should be aware they might receive partial contexts.
		return contexts as AgentContext[];
	}

	async clear(): Promise<void> {
		const querySnapshot = await this.db.collection('AgentContext').get();
		for (const doc of querySnapshot.docs) {
			await doc.ref.delete();
		}
	}

	@span()
	async delete(ids: string[]): Promise<void> {
		// First load all agents to handle parent-child relationships
		let agents = await Promise.all(
			ids.map(async (id) => {
				try {
					// Load only necessary fields for deletion logic
					const docRef = this.db.doc(`AgentContext/${id}`);
					const docSnap = await docRef.get();
					if (!docSnap.exists) return null;
					const data = docSnap.data();
					return {
						agentId: id,
						user: { id: data.user }, // Assuming user is stored as ID string
						state: data.state,
						parentAgentId: data.parentAgentId,
						childAgents: data.childAgents,
					} as Partial<AgentContext>; // Use partial type
				} catch (error) {
					logger.error(error, `Error loading agent ${id} for deletion`);
					return null;
				}
			}),
		);

		const user = currentUser();

		agents = agents
			.filter((agent): agent is Partial<AgentContext> => !!agent) // Filter out nulls (non-existent ids)
			.filter((agent) => agent.user?.id === user.id) // Can only delete your own agents
			.filter((agent) => !agent.state || !isExecuting(agent as AgentContext)) // Can only delete non-executing agents (handle potentially missing state)
			.filter((agent) => !agent.parentAgentId); // Only delete parent agents. Child agents are deleted with the parent agent.

		// Now delete the agents
		const deleteBatch = this.db.batch();
		for (const agent of agents) {
			if (!agent.agentId) continue; // Should not happen, but safety check
			for (const childId of agent.childAgents ?? []) {
				deleteBatch.delete(this.db.doc(`AgentContext/${childId}`));
				// TODO: Handle grandchild agents recursively if needed
				// This would require loading child agents fully or implementing a recursive delete function.
			}
			const docRef = this.db.doc(`AgentContext/${agent.agentId}`);
			deleteBatch.delete(docRef);
		}

		await deleteBatch.commit();
	}

	async updateFunctions(agentId: string, functions: string[]): Promise<void> {
		const agent = await this.load(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}
		if (agent.user.id !== currentUser().id) {
			throw new Error('Cannot update functions for an agent you do not own.');
		}

		agent.functions = new LlmFunctionsImpl();
		for (const functionName of functions) {
			const FunctionClass = functionFactory()[functionName];
			if (FunctionClass) {
				agent.functions.addFunctionClass(FunctionClass);
			} else {
				logger.warn(`Function ${functionName} not found in function factory`);
			}
		}

		await this.save(agent);
	}

	@span()
	async saveIteration(iterationData: AutonomousIteration): Promise<void> {
		// Validate iteration number
		if (!Number.isInteger(iterationData.iteration) || iterationData.iteration <= 0) {
			throw new Error('Iteration number must be a positive integer.');
		}

		// Ensure large fields are handled (optional, depending on expected size vs limits)
		// Example: Truncate prompt or code if necessary, similar to how errors are handled in save()
		// Consider adding truncation logic here if fields like prompt, agentPlan, or code can exceed limits.
		// e.g., if (iterationData.prompt && Buffer.byteLength(iterationData.prompt, 'utf8') > MAX_PROPERTY_SIZE) { iterationData.prompt = truncateToByteLength(iterationData.prompt, MAX_PROPERTY_SIZE - 100) + '... (truncated)'; }
		// e.g., if (iterationData.code && Buffer.byteLength(iterationData.code, 'utf8') > MAX_PROPERTY_SIZE) { iterationData.code = truncateToByteLength(iterationData.code, MAX_PROPERTY_SIZE - 100) + '... (truncated)'; }
		// e.g., if (iterationData.agentPlan && Buffer.byteLength(iterationData.agentPlan, 'utf8') > MAX_PROPERTY_SIZE) { iterationData.agentPlan = truncateToByteLength(iterationData.agentPlan, MAX_PROPERTY_SIZE - 100) + '... (truncated)'; }
		// e.g., if (iterationData.error && Buffer.byteLength(iterationData.error, 'utf8') > MAX_PROPERTY_SIZE) { iterationData.error = truncateToByteLength(iterationData.error, MAX_PROPERTY_SIZE - 100) + '... (truncated)'; }

		if (iterationData.error && Buffer.byteLength(iterationData.error, 'utf8') > MAX_PROPERTY_SIZE / 2) {
			iterationData.error = truncateToByteLength(iterationData.error, MAX_PROPERTY_SIZE / 2);
		}

		const iterationDocRef = this.db.collection('AgentContext').doc(iterationData.agentId).collection('iterations').doc(String(iterationData.iteration));

		// Create a Firestore-compatible version of the iteration data using the specific type
		const firestoreIterationData: FirestoreAutonomousIteration = {
			...iterationData,
			// Convert Maps to plain objects for Firestore
			memory: iterationData.memory instanceof Map ? Object.fromEntries(iterationData.memory) : {},
			toolState: iterationData.toolState instanceof Map ? Object.fromEntries(iterationData.toolState) : {},
		};

		// Add validation before saving using the converted data
		try {
			// Ensure all nested properties are valid for Firestore
			validateFirestoreObject(firestoreIterationData); // Validate the Firestore-specific object
		} catch (error) {
			// Log detailed error including which agent/iteration failed validation
			logger.error(
				{
					agentId: iterationData.agentId,
					iteration: iterationData.iteration, // Log original iteration
					error: error.message,
					// Optionally log keys or a summary of the data for debugging
					iterationDataKeys: Object.keys(firestoreIterationData), // Log keys of the object being saved
				},
				'Firestore validation failed for iteration data before saving.',
			);
			// Re-throw the validation error to prevent attempting to save invalid data
			throw new Error(`Firestore validation failed for agent ${iterationData.agentId}, iteration ${iterationData.iteration}: ${error.message}`);
		}

		try {
			// Save the Firestore-compatible data
			await iterationDocRef.set(firestoreIterationData); // Save the Firestore-specific object
			logger.debug({ agentId: iterationData.agentId, iteration: iterationData.iteration }, 'Saved agent iteration');
		} catch (error) {
			// Log detailed error including which agent/iteration failed the save operation
			logger.error(
				{
					agentId: iterationData.agentId,
					iteration: iterationData.iteration, // Log original iteration
					// Log the actual Firestore error
					firestoreError: error.message, // Log the underlying Firestore error message
					// Optionally log keys or a summary of the data for debugging
					iterationDataKeys: Object.keys(firestoreIterationData), // Log keys of the object being saved
				},
				`Error saving iteration ${iterationData.iteration} for agent ${iterationData.agentId} to Firestore`,
			);
			// Re-throw the error so the calling code is aware of the failure
			throw error; // Re-throw the original Firestore error
		}
	}

	@span()
	async loadIterations(agentId: string): Promise<AutonomousIteration[]> {
		const agent = await this.load(agentId);
		if (!agent) throw new Error('Agent Id does not exist');
		if (agent.user.id !== currentUser().id) throw new Error('Not your agent');

		const iterationsColRef = this.db.collection('AgentContext').doc(agentId).collection('iterations');
		// Order by the document ID (which is the iteration number as a string)
		// Firestore sorts strings lexicographically, which works for numbers if they don't have leading zeros
		// and have the same number of digits. For simple iteration counts (1, 2, ..., 10, 11...), this works.
		// If very large iteration numbers or inconsistent formatting were expected,
		// storing the iteration number as a field and ordering by that would be more robust.
		const querySnapshot = await iterationsColRef.orderBy('__name__').get(); // Order by document ID (iteration number)

		const iterations: AutonomousIteration[] = [];
		querySnapshot.forEach((doc) => {
			const data = doc.data();
			if (data && typeof data.iteration === 'number') {
				// Convert memory object back to Map if it exists and is an object
				if (data.memory && typeof data.memory === 'object' && !(data.memory instanceof Map) && !Array.isArray(data.memory)) {
					data.memory = new Map(Object.entries(data.memory));
				} else if (!data.memory) {
					// Ensure memory is at least an empty map if missing or null/undefined from DB
					data.memory = new Map<string, string>();
				}

				// Convert toolState object back to Map if it exists and is an object
				if (data.toolState && typeof data.toolState === 'object' && !(data.toolState instanceof Map) && !Array.isArray(data.toolState)) {
					data.toolState = new Map(Object.entries(data.toolState));
				} else if (!data.toolState) {
					// Ensure toolState is at least an empty map if missing or null/undefined from DB
					data.toolState = new Map<string, any>();
				}

				// Ensure optional fields are correctly handled (set to undefined if missing/null)
				data.error = data.error || undefined;
				data.agentPlan = data.agentPlan || undefined;
				data.code = data.code || undefined;
				data.prompt = data.prompt || undefined;
				data.functionCalls = data.functionCalls || [];
				data.functions = data.functions || [];
				// expandedUserRequest, observationsReasoning, nextStepDetails might also need default handling if optional
				data.expandedUserRequest = data.expandedUserRequest || undefined;
				data.observationsReasoning = data.observationsReasoning || undefined;
				data.nextStepDetails = data.nextStepDetails || undefined;
				// Ensure optional fields potentially missing from Firestore are set
				data.draftCode = data.draftCode || undefined;
				data.codeReview = data.codeReview || undefined;

				iterations.push(data as AutonomousIteration);
			} else {
				logger.warn({ agentId, iterationId: doc.id }, 'Skipping invalid iteration data during load (missing or invalid iteration number)');
			}
		});

		// Ensure sorting numerically as Firestore sorts document IDs lexicographically
		iterations.sort((a, b) => a.iteration - b.iteration);

		return iterations;
	}
}
