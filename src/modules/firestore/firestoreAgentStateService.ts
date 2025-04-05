import { DocumentSnapshot, Firestore } from '@google-cloud/firestore';
import { LlmFunctions } from '#agent/LlmFunctions';
import { AgentContext, AgentRunningState, isExecuting } from '#agent/agentContextTypes';
import { deserializeAgentContext, serializeContext } from '#agent/agentSerialization';
import { AgentStateService } from '#agent/agentStateService/agentStateService';
import { functionFactory } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { User } from '#user/user';
import { currentUser } from '#user/userService/userContext';
import { firestoreDb } from './firestore';

/**
 * Google Firestore implementation of AgentStateService
 */
export class FirestoreAgentStateService implements AgentStateService {
	db: Firestore = firestoreDb();

	@span()
	async save(state: AgentContext): Promise<void> {
		const serialized = serializeContext(state);
		serialized.lastUpdate = Date.now();
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

	@span({ agentId: 0 })
	async load(agentId: string): Promise<AgentContext | null> {
		const docRef = this.db.doc(`AgentContext/${agentId}`);
		const docSnap: DocumentSnapshot = await docRef.get();
		if (!docSnap.exists) {
			return null;
		}
		const data = docSnap.data();
		return deserializeAgentContext({
			...data,
			agentId,
		} as Record<keyof AgentContext, any>);
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
		const terminalStates: AgentRunningState[] = ['completed', 'shutdown', 'timeout']; // TODO add error and maybe others. Might be better to invert the list and use the IN operator
		// NOTE: This query requires a composite index in Firestore.
		// Example gcloud command:
		// gcloud firestore indexes composite create --collection-group=AgentContext --query-scope=COLLECTION --field-config field-path=state,operator=NOT_EQUAL --field-config field-path=lastUpdate,order=DESCENDING
		// Or more specifically for 'not-in':
		// gcloud firestore indexes composite create --collection-group=AgentContext --query-scope=COLLECTION --field-config field-path=state,operator=NOT_EQUAL --field-config field-path=lastUpdate,order=DESCENDING
		// Or more specifically for 'not-in':
		// gcloud firestore indexes composite create --collection-group=AgentContext --query-scope=COLLECTION --field-config field-path=state,array-contains=Any --field-config field-path=lastUpdate,order=DESCENDING
		// Firestore usually guides index creation in the console based on query errors.
		// NOTE: Firestore requires the first orderBy clause to be on the field used in an inequality filter (like 'not-in').
		// Therefore, we order by 'state' first, then by 'lastUpdate'. This ensures the query works reliably,
		// although the primary desired sort order is by 'lastUpdate'.
		const querySnapshot = await this.db
			.collection('AgentContext')
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
					return await this.load(id); // only need to load the childAgents property
				} catch (error) {
					logger.error(error, `Error loading agent ${id} for deletion`);
					return null;
				}
			}),
		);

		const user = currentUser();

		agents = agents
			.filter((agent) => !!agent) // Filter out non-existent ids
			.filter((agent) => agent.user.id === user.id) // Can only delete your own agents
			.filter((agent) => !isExecuting(agent)) // Can only delete executing agents
			.filter((agent) => !agent.parentAgentId); // Only delete parent agents. Child agents are deleted with the parent agent.

		// Now delete the agents
		const deleteBatch = this.db.batch();
		for (const agent of agents) {
			for (const childId of agent.childAgents ?? []) {
				deleteBatch.delete(this.db.doc(`AgentContext/${childId}`));
			}
			// TODO will need to handle if child agents have child agents
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

		agent.functions = new LlmFunctions();
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
}
