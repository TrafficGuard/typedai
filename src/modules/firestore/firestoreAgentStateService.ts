import type { DocumentSnapshot, FieldPath, Firestore } from '@google-cloud/firestore';
import type { Static } from '@sinclair/typebox';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import { deserializeContext, serializeContext } from '#agent/agentSerialization';
import { MAX_PROPERTY_SIZE, truncateToByteLength, validateFirestoreObject } from '#firestore/firestoreUtils';
import { functionFactory } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import {
	AGENT_PREVIEW_KEYS,
	type AgentContext,
	type AgentContextPreview,
	type AgentRunningState,
	type AutonomousIteration,
	type AutonomousIterationSummary,
	isExecuting,
} from '#shared/agent/agent.model';
import type { AgentContextSchema } from '#shared/agent/agent.schema';
import { NotAllowed, NotFound } from '#shared/errors';
import { currentUser, isSingleUser } from '#user/userContext';
import { firestoreDb } from './firestore';

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
		// Always persist a simple string so that ownership checks work reliably with Firestore equality filters
		serialized.user = typeof state.user === 'string' ? state.user : state.user.id;
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

				const parentData = parentDoc.data()!;
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
		if (!docSnap.exists) return null;

		const firestoreData = docSnap.data();
		if (!firestoreData) {
			logger.warn({ agentId }, 'Firestore document exists but data is undefined during agent context load.');
			throw new NotFound(`Agent with ID ${agentId} found but data is missing.`);
		}

		// Extract owner id whether the field is stored as a string or an object
		const ownerId = typeof firestoreData.user === 'string' ? firestoreData.user : firestoreData.user?.id;

		const user = currentUser();
		if (ownerId !== user.id && !user.admin) {
			logger.warn({ agentId, currentUserId: user.id, ownerId: ownerId }, 'Attempt to load agent not owned by current user.');
			throw new NotAllowed(`Access denied to agent ${agentId}.`);
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
	async findByMetadata(key: string, value: string): Promise<AgentContext | null> {
		const currentUserId = currentUser().id;
		const metadataFieldPath = `metadata.${key}`;

		// Firestore queries are immutable; reassign when adding filters
		let query: FirebaseFirestore.Query = this.db.collection('AgentContext');
		if (!currentUser().admin) query = query.where('user', '==', currentUserId); // Filter by user first
		const querySnapshot = await query.where(metadataFieldPath, '==', value).limit(1).get();

		if (querySnapshot.empty) return null;

		const docSnap = querySnapshot.docs[0];
		const firestoreData = docSnap.data();
		if (!firestoreData) {
			logger.warn({ agentId: docSnap.id, key, value }, 'Firestore document exists for findByMetadata but data is undefined.');
			return null; // Or throw, but null is consistent with "not found"
		}

		// Construct the object ensuring it aligns with AgentContextSchema.
		const schemaCompliantData = {
			...firestoreData,
			agentId: docSnap.id,
		} as Static<typeof AgentContextSchema>;

		return deserializeContext(schemaCompliantData);
	}

	@span()
	async list(): Promise<AgentContextPreview[]> {
		// Firestore queries are immutable; reassign when adding filters
		let query: FirebaseFirestore.Query = this.db.collection('AgentContext');
		if (!currentUser().admin) query = query.where('user', '==', currentUser().id); // Filter by user first
		const querySnapshot = await query
			.select(...AGENT_PREVIEW_KEYS)
			.orderBy('lastUpdate', 'desc')
			.limit(50)
			.get();
		return this.deserializeQuery(querySnapshot);
	}

	@span()
	async listRunning(): Promise<AgentContextPreview[]> {
		// Define terminal states to exclude from the "running" list
		// TODO this list should be defined in agent.model.ts
		const terminalStates: AgentRunningState[] = ['completed', 'shutdown', 'timeout', 'error']; // Added 'error' as it's typically terminal
		// NOTE: This query requires a composite index in Firestore.
		// Example gcloud command:
		// gcloud firestore indexes composite create --collection-group=AgentContext --query-scope=COLLECTION --field-config field-path=user,order=ASCENDING --field-config field-path=state,operator=NOT_IN --field-config field-path=lastUpdate,order=DESCENDING
		// Firestore usually guides index creation in the console based on query errors.
		// NOTE: Firestore requires the first orderBy clause to be on the field used in an inequality filter (like 'not-in').
		// Therefore, we order by 'state' first, then by 'lastUpdate'. This ensures the query works reliably,
		// although the primary desired sort order is by 'lastUpdate'.
		// Firestore queries are immutable; reassign when adding filters
		let query: FirebaseFirestore.Query = this.db.collection('AgentContext');
		if (!currentUser().admin) query = query.where('user', '==', currentUser().id); // Filter by user first
		const querySnapshot = await query
			.where('state', 'not-in', terminalStates) // Use 'not-in' to exclude multiple terminal states
			.select(...AGENT_PREVIEW_KEYS) // Ensure this select uses previewKeys
			.orderBy('state') // Order by the inequality filter field first (Firestore requirement)
			.orderBy('lastUpdate', 'desc') // Then order by the desired field
			.get();
		return this.deserializeQuery(querySnapshot);
	}

	private async deserializeQuery(
		querySnapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData, FirebaseFirestore.DocumentData>,
	): Promise<AgentContextPreview[]> {
		const previews: AgentContextPreview[] = [];
		for (const doc of querySnapshot.docs) {
			const data = doc.data();
			const preview: AgentContextPreview = {
				agentId: doc.id,
				name: data.name,
				type: data.type,
				subtype: data.subType ?? '',
				state: data.state,
				parentAgentId: data.parentAgentId,
				cost: (Number.isNaN(data.cost) ? 0 : data.cost) ?? 0,
				error: typeof data.error === 'string' ? data.error : undefined,
				lastUpdate: data.lastUpdate,
				userPrompt: data.userPrompt,
				inputPrompt: data.inputPrompt,
				user: data.user,
				createdAt: Number.isInteger(data.createdAt) ? data.createdAt : Date.now(),
				metadata: data.metadata,
			};
			previews.push(preview);
		}
		return previews;
	}

	async clear(): Promise<void> {
		const querySnapshot = await this.db.collection('AgentContext').get();
		for (const doc of querySnapshot.docs) {
			await doc.ref.delete();
		}
	}

	@span()
	async delete(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const user = currentUser();
		const userId = user.id;
		const isAdmin = user.admin;

		// First load all agents to handle parent-child relationships and ownership/state checks
		let agents = await Promise.all(
			ids.map(async (id) => {
				try {
					// Load only necessary fields for deletion logic
					const docRef = this.db.doc(`AgentContext/${id}`);
					const docSnap = await docRef.get();
					if (!docSnap.exists) return null;
					const data = docSnap.data()!;
					if (data.user !== userId && !isAdmin) return null;
					return {
						agentId: id,
						user: data.user,
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

		agents = agents
			.filter((agent): agent is Partial<AgentContext> => !!agent) // Filter out nulls (non-existent ids)
			.filter((agent) => {
				const ownerId = typeof agent.user === 'string' ? agent.user : agent.user?.id;
				return ownerId === userId || isAdmin;
			})
			.filter((agent) => !agent.state || !isExecuting(agent as AgentContext)) // Can only delete non-executing agents (handle potentially missing state)
			.filter((agent) => !agent.parentAgentId); // Only delete parent agents. Child agents are deleted with the parent agent.

		// Now delete the agents
		const deleteBatch = this.db.batch();
		for (const agent of agents) {
			if (!agent) continue;
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
		// Load the agent first to check existence and ownership
		const agent = await this.load(agentId); // This will throw NotAllowed if necessary
		if (!agent) throw new NotFound(`Agent with ID ${agentId} not found.`);

		const user = currentUser();
		if (!user.admin && agent.user.id !== user.id) throw new Error(`Access denied to update functions for agent ${agentId}`);
		// Agent is guaranteed to exist and be owned by the current user here

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
		// e.g., if (iterationData.error && Buffer.byteLength(iterationData.error, 'utf8') > MAX_PROPERTY_SIZE) { iterationData.error = truncateToByteLength(iterationData.error, MAX_PROPERTY_SIZE / 2); }

		if (iterationData.error && Buffer.byteLength(iterationData.error, 'utf8') > MAX_PROPERTY_SIZE / 2) {
			iterationData.error = truncateToByteLength(iterationData.error, MAX_PROPERTY_SIZE / 2);
		}

		const iterationDocRef = this.db.collection('AgentContext').doc(iterationData.agentId).collection('iterations').doc(String(iterationData.iteration));

		// Create a Firestore-compatible version of the iteration data using the specific type
		const firestoreIterationData: AutonomousIteration = {
			...iterationData,
			// memory and toolState are expected to be Records. Default to {} if null/undefined.
			memory: iterationData.memory || {},
			toolState: iterationData.toolState || {},
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
			console.log(typeof firestoreIterationData.toolState);
			for (const [k, v] of Object.entries(firestoreIterationData.toolState ?? {})) {
			}
			console.log(firestoreIterationData.toolState);
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
		// Load the agent first to check existence and ownership
		const agent = await this.load(agentId); // This will throw NotAllowed if necessary
		if (!agent) throw new NotFound(`Agent with ID ${agentId} not found.`);

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
				// Ensure memory is a Record, defaulting to {} if missing or not a valid object.
				data.memory = data.memory && typeof data.memory === 'object' && !Array.isArray(data.memory) ? data.memory : {};

				// Ensure toolState is a Record, defaulting to {} if missing or not a valid object.
				data.toolState = data.toolState && typeof data.toolState === 'object' && !Array.isArray(data.toolState) ? data.toolState : {};

				// Ensure optional fields are correctly handled (set to undefined if missing/null)
				data.error = data.error || undefined;
				data.agentPlan = data.agentPlan || undefined;
				data.code = data.code || undefined;
				data.prompt = data.prompt || undefined;
				data.functionCalls = data.functionCalls || [];
				data.functions = data.functions || [];
				data.createdAt = data.createdAt || Date.now();
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

	@span()
	async getAgentIterationSummaries(agentId: string): Promise<AutonomousIterationSummary[]> {
		// Load the agent first to check existence and ownership
		const agent = await this.load(agentId); // This will throw NotAllowed if necessary
		if (!agent) throw new NotFound(`Agent with ID ${agentId} not found.`);

		const iterationsColRef = this.db.collection('AgentContext').doc(agentId).collection('iterations');
		// Select only the fields needed for the summary.
		// Note: Firestore's select() method with FieldPath.documentId() might be complex.
		// It's often simpler to fetch minimal fields and construct the ID from the doc.id.
		// Here, 'iteration' is a field, so we can select it directly.
		const querySnapshot = await iterationsColRef
			.select('iteration', 'createdAt', 'cost', 'summary', 'error') // Select only necessary fields
			.orderBy('iteration', 'asc') // Order by iteration number
			.get();

		const summaries: AutonomousIterationSummary[] = [];
		querySnapshot.forEach((doc) => {
			const data = doc.data();
			if (data && typeof data.iteration === 'number') {
				summaries.push({
					agentId: agentId,
					iteration: data.iteration,
					createdAt: data.createdAt ?? 0,
					cost: data.cost ?? 0,
					summary: data.summary ?? '',
					error: data.error,
				});
			} else {
				logger.warn({ agentId, iterationId: doc.id }, 'Skipping invalid iteration data during summary load (missing or invalid iteration number)');
			}
		});
		return summaries;
	}

	@span()
	async getAgentIterationDetail(agentId: string, iterationNumber: number): Promise<AutonomousIteration> {
		// Load the agent first to check existence and ownership
		const agent = await this.load(agentId); // This will throw NotAllowed if necessary
		if (!agent) throw new NotFound(`Agent with ID ${agentId} not found.`);

		const iterationDocRef = this.db.collection('AgentContext').doc(agentId).collection('iterations').doc(String(iterationNumber));
		const docSnap = await iterationDocRef.get();

		if (!docSnap.exists) {
			throw new NotFound(`Iteration ${iterationNumber} for agent ${agentId} not found.`);
		}

		const data = docSnap.data();
		if (data && typeof data.iteration === 'number') {
			// Ensure memory is a Record, defaulting to {} if missing or not a valid object.
			data.memory = data.memory && typeof data.memory === 'object' && !Array.isArray(data.memory) ? data.memory : {};
			// Ensure toolState is a Record, defaulting to {} if missing or not a valid object.
			data.toolState = data.toolState && typeof data.toolState === 'object' && !Array.isArray(data.toolState) ? data.toolState : {};
			// Ensure optional fields are correctly handled
			data.error = data.error || undefined;
			data.agentPlan = data.agentPlan || undefined;
			data.code = data.code || undefined;
			data.prompt = data.prompt || undefined;
			data.functionCalls = data.functionCalls || [];
			data.functions = data.functions || [];
			data.expandedUserRequest = data.expandedUserRequest || undefined;
			data.observationsReasoning = data.observationsReasoning || undefined;
			data.nextStepDetails = data.nextStepDetails || undefined;
			data.draftCode = data.draftCode || undefined;
			data.codeReview = data.codeReview || undefined;
			// Images might be stored as an array of objects
			data.images = data.images || [];

			return data as AutonomousIteration;
		}
		// This case should ideally not be reached if docSnap.exists is true and data is valid.
		// If data is malformed, it's an unexpected server error or data corruption.
		logger.error({ agentId, iterationNumber }, 'Invalid iteration data found for detail load despite document existence.');
		throw new Error(`Invalid iteration data for agent ${agentId}, iteration ${iterationNumber}.`);
	}
}
