import type { CodeTaskRepository } from '#codeTask/codeTaskRepository';
import type { CodeTask, CodeTaskPreset, UpdateCodeTaskData } from '#shared/codeTask/codeTask.model';
import { Db } from 'mongodb';

export class MongoCodeTaskRepository implements CodeTaskRepository {
	constructor(private db: Db) {}

	async createCodeTask(codeTask: CodeTask): Promise<string> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getCodeTask(userId: string, codeTaskId: string): Promise<CodeTask | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async listCodeTasks(userId: string): Promise<CodeTask[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async updateCodeTask(userId: string, codeTaskId: string, updates: UpdateCodeTaskData): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async deleteCodeTask(userId: string, codeTaskId: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async saveCodeTaskPreset(preset: CodeTaskPreset): Promise<string> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async listCodeTaskPresets(userId: string): Promise<CodeTaskPreset[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async deleteCodeTaskPreset(userId: string, presetId: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}
}
