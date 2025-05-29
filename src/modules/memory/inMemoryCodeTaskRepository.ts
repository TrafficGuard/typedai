import type { CodeTaskRepository } from '#codeTask/codeTaskRepository';
import type { CodeTask, CodeTaskPreset, UpdateCodeTaskData } from '#shared/codeTask/codeTask.model';

/**
 * In-memory implementation of CodeTaskRepository for testing and development.
 * Simulates data persistence without external dependencies.
 */
export class InMemoryCodeTaskRepository implements CodeTaskRepository {
	private codeTasks: Map<string, CodeTask> = new Map();
	private presets: Map<string, CodeTaskPreset> = new Map();

	// Helper to simulate server timestamp behavior
	private getServerTimestamp(): number {
		return Date.now();
	}

	// --- CodeTask CRUD ---

	async createCodeTask(codeTask: CodeTask): Promise<string> {
		if (!codeTask.id || !codeTask.userId) {
			throw new Error('CodeTask ID and User ID must be provided');
		}
		if (this.codeTasks.has(codeTask.id)) {
			throw new Error(`CodeTask with ID ${codeTask.id} already exists.`);
		}
		const now = this.getServerTimestamp();
		const codeTaskToSave: CodeTask = {
			...codeTask,
			createdAt: codeTask.createdAt || now,
			updatedAt: codeTask.updatedAt || now,
			lastAgentActivity: codeTask.lastAgentActivity || now,
		};
		this.codeTasks.set(codeTask.id, codeTaskToSave);
		return codeTask.id;
	}

	async getCodeTask(userId: string, codeTaskId: string): Promise<CodeTask | null> {
		const codeTask = this.codeTasks.get(codeTaskId);
		// Basic authorization check (in-memory doesn't have user context like Firestore)
		if (codeTask && codeTask.userId === userId) {
			return { ...codeTask }; // Return a copy to prevent mutation
		}
		return null;
	}

	async listCodeTasks(userId: string): Promise<CodeTask[]> {
		const userCodeTasks = Array.from(this.codeTasks.values())
			.filter((s) => s.userId === userId)
			.sort((a, b) => (b.createdAt as number) - (a.createdAt as number)); // Descending order

		return userCodeTasks.map((s) => ({ ...s })); // Return copies
	}

	async updateCodeTask(userId: string, codeTaskId: string, updates: UpdateCodeTaskData): Promise<void> {
		const existingCodeTask = this.codeTasks.get(codeTaskId);
		if (!existingCodeTask || existingCodeTask.userId !== userId) {
			throw new Error(`CodeTask ${codeTaskId} not found for user ${userId}.`);
		}

		const now = this.getServerTimestamp();
		const updatedCodeTask: CodeTask = {
			...existingCodeTask,
			...updates,
			updatedAt: updates.updatedAt || now, // Use provided or generate new timestamp
			// lastAgentActivity should be explicitly included in updates if it changes
		};

		this.codeTasks.set(codeTaskId, updatedCodeTask);
	}

	async deleteCodeTask(userId: string, codeTaskId: string): Promise<void> {
		const codeTask = this.codeTasks.get(codeTaskId);
		// Only delete if it exists and belongs to the user
		if (codeTask && codeTask.userId === userId) {
			this.codeTasks.delete(codeTaskId);
		}
		// No error if not found, matching Firestore behavior
	}

	// --- Preset CRUD ---

	async saveCodeTaskPreset(preset: CodeTaskPreset): Promise<string> {
		if (!preset.id || !preset.userId || !preset.name) {
			throw new Error('Preset ID, User ID, and Name must be provided');
		}
		if (this.presets.has(preset.id)) {
			throw new Error(`Preset with ID ${preset.id} already exists.`);
		}
		const now = Date.now();
		const presetToSave: CodeTaskPreset = {
			...preset,
			createdAt: preset.createdAt || now,
			updatedAt: preset.updatedAt || now,
		};
		this.presets.set(preset.id, presetToSave);
		return preset.id;
	}

	async listCodeTaskPresets(userId: string): Promise<CodeTaskPreset[]> {
		const userPresets = Array.from(this.presets.values())
			.filter((p) => p.userId === userId)
			.sort((a, b) => (b.createdAt as number) - (a.createdAt as number)); // Descending order

		return userPresets.map((p) => ({ ...p })); // Return copies
	}

	async deleteCodeTaskPreset(userId: string, presetId: string): Promise<void> {
		const preset = this.presets.get(presetId);
		// Only delete if it exists and belongs to the user
		if (preset && preset.userId === userId) {
			this.presets.delete(presetId);
		}
		// No error if not found
	}

	// --- Test Helper ---
	/** Clears all data from the in-memory store. For testing purposes only. */
	clear(): void {
		this.codeTasks.clear();
		this.presets.clear();
	}
}
