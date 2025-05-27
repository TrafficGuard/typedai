import { randomUUID } from 'node:crypto';
import type { Insertable, Selectable, Updateable } from 'kysely';
import type { SelectedFile } from '#shared/model/files.model';
import type { UpdateVibeSessionData, VibePreset, VibePresetConfig, VibeSession, VibeStatus } from '#shared/model/vibe.model';
import type { VibeRepository } from '#vibe/vibeRepository';
import { db } from './db';
import type { VibePresetsTable, VibeSessionsTable } from './db';
// Import logger if you plan to add logging, though not strictly required by tests
// import { logger } from '#o11y/logger';

// Helper functions
function dbToVibeSession(dbRow: Selectable<VibeSessionsTable>): VibeSession {
	return {
		id: dbRow.id,
		userId: dbRow.user_id,
		title: dbRow.title,
		instructions: dbRow.instructions,
		repositorySource: dbRow.repository_source as VibeSession['repositorySource'],
		repositoryId: dbRow.repository_id,
		repositoryName: dbRow.repository_name ?? undefined,
		targetBranch: dbRow.target_branch,
		workingBranch: dbRow.working_branch,
		createWorkingBranch: dbRow.create_working_branch,
		useSharedRepos: dbRow.use_shared_repos,
		status: dbRow.status as VibeStatus,
		lastAgentActivity: Number(dbRow.last_agent_activity),
		fileSelection: dbRow.file_selection_serialized ? (JSON.parse(dbRow.file_selection_serialized) as SelectedFile[]) : undefined,
		designAnswer: dbRow.design_answer_serialized ?? undefined,
		codeDiff: dbRow.code_diff ?? undefined,
		commitSha: dbRow.commit_sha ?? undefined,
		pullRequestUrl: dbRow.pull_request_url ?? undefined,
		ciCdStatus: (dbRow.ci_cd_status as VibeSession['ciCdStatus']) ?? undefined,
		ciCdJobUrl: dbRow.ci_cd_job_url ?? undefined,
		ciCdAnalysis: dbRow.ci_cd_analysis ?? undefined,
		ciCdProposedFix: dbRow.ci_cd_proposed_fix ?? undefined,
		createdAt: Number(dbRow.created_at),
		updatedAt: Number(dbRow.updated_at),
		agentHistory: dbRow.agent_history_serialized ? (JSON.parse(dbRow.agent_history_serialized) as string[]) : undefined,
		error: dbRow.error_message ?? undefined,
	};
}

function vibeSessionToDbInsert(session: VibeSession): Insertable<VibeSessionsTable> {
	const now = Date.now();
	return {
		id: session.id, // Assuming ID is pre-generated as per test helpers
		user_id: session.userId,
		title: session.title,
		instructions: session.instructions,
		repository_source: session.repositorySource,
		repository_id: session.repositoryId,
		repository_name: session.repositoryName ?? null,
		target_branch: session.targetBranch,
		working_branch: session.workingBranch,
		create_working_branch: session.createWorkingBranch,
		use_shared_repos: session.useSharedRepos,
		status: session.status,
		last_agent_activity: session.lastAgentActivity ?? now,
		file_selection_serialized: session.fileSelection ? JSON.stringify(session.fileSelection) : null,
		design_answer_serialized: session.designAnswer ? JSON.stringify(session.designAnswer) : null,
		code_diff: session.codeDiff ?? null,
		commit_sha: session.commitSha ?? null,
		pull_request_url: session.pullRequestUrl ?? null,
		ci_cd_status: session.ciCdStatus ?? null,
		ci_cd_job_url: session.ciCdJobUrl ?? null,
		ci_cd_analysis: session.ciCdAnalysis ?? null,
		ci_cd_proposed_fix: session.ciCdProposedFix ?? null,
		created_at: session.createdAt ?? now,
		updated_at: session.updatedAt ?? now,
		agent_history_serialized: session.agentHistory ? JSON.stringify(session.agentHistory) : null,
		error_message: session.error ?? null,
	};
}

function vibeSessionToDbUpdate(
	updates: UpdateVibeSessionData,
): Omit<
	Updateable<VibeSessionsTable>,
	'id' | 'user_id' | 'created_at' | 'repository_id' | 'target_branch' | 'working_branch' | 'create_working_branch' | 'repository_source'
> {
	// Create a partial object for updates, ensuring updated_at is always set.
	// The Omit<> type helps ensure we don't try to update immutable fields.
	const dbUpdate: Partial<Omit<Updateable<VibeSessionsTable>, 'id' | 'user_id' | 'created_at'>> & { updated_at: number } = {
		updated_at: Date.now(),
	};

	if (updates.title !== undefined) dbUpdate.title = updates.title;
	if (updates.instructions !== undefined) dbUpdate.instructions = updates.instructions;
	if (updates.repositoryName !== undefined) dbUpdate.repository_name = updates.repositoryName;
	if (updates.useSharedRepos !== undefined) dbUpdate.use_shared_repos = updates.useSharedRepos;
	if (updates.status !== undefined) dbUpdate.status = updates.status;
	if (updates.lastAgentActivity !== undefined) dbUpdate.last_agent_activity = updates.lastAgentActivity;
	if (updates.fileSelection !== undefined) {
		dbUpdate.file_selection_serialized = updates.fileSelection === null ? null : JSON.stringify(updates.fileSelection);
	}
	if (updates.designAnswer !== undefined) {
		dbUpdate.design_answer_serialized = updates.designAnswer === null ? null : JSON.stringify(updates.designAnswer);
	}
	if (updates.codeDiff !== undefined) dbUpdate.code_diff = updates.codeDiff;
	if (updates.commitSha !== undefined) dbUpdate.commit_sha = updates.commitSha;
	if (updates.pullRequestUrl !== undefined) dbUpdate.pull_request_url = updates.pullRequestUrl;
	if (updates.ciCdStatus !== undefined) dbUpdate.ci_cd_status = updates.ciCdStatus;
	if (updates.ciCdJobUrl !== undefined) dbUpdate.ci_cd_job_url = updates.ciCdJobUrl;
	if (updates.ciCdAnalysis !== undefined) dbUpdate.ci_cd_analysis = updates.ciCdAnalysis;
	if (updates.ciCdProposedFix !== undefined) dbUpdate.ci_cd_proposed_fix = updates.ciCdProposedFix;
	if (updates.agentHistory !== undefined) {
		dbUpdate.agent_history_serialized = updates.agentHistory === null ? null : JSON.stringify(updates.agentHistory);
	}
	if (updates.error !== undefined) dbUpdate.error_message = updates.error;

	// Note: 'filesToAdd' and 'filesToRemove' from UpdateVibeSessionData are not directly handled here.
	// It's assumed the service layer would process these and provide the final 'fileSelection'.

	return dbUpdate;
}

function dbToVibePreset(dbRow: Selectable<VibePresetsTable>): VibePreset {
	return {
		id: dbRow.id,
		userId: dbRow.user_id,
		name: dbRow.name,
		config: JSON.parse(dbRow.config_serialized) as VibePresetConfig,
		createdAt: Number(dbRow.created_at),
		updatedAt: Number(dbRow.updated_at),
	};
}

function vibePresetToDbInsert(preset: VibePreset): Insertable<VibePresetsTable> {
	const now = Date.now();
	return {
		id: preset.id, // Assuming ID is pre-generated
		user_id: preset.userId,
		name: preset.name,
		config_serialized: JSON.stringify(preset.config),
		created_at: preset.createdAt ?? now,
		updated_at: preset.updatedAt ?? now,
	};
}

export class PostgresVibeRepository implements VibeRepository {
	async createVibeSession(session: VibeSession): Promise<string> {
		if (!session.id) {
			// The test suite pre-assigns IDs via createMockSession
			throw new Error('VibeSession ID must be provided for creation.');
		}
		const dbSession = vibeSessionToDbInsert(session);
		await db.insertInto('vibe_sessions').values(dbSession).executeTakeFirstOrThrow();
		return session.id;
	}

	async getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null> {
		const row = await db.selectFrom('vibe_sessions').selectAll().where('id', '=', sessionId).where('user_id', '=', userId).executeTakeFirst();
		if (!row) return null;

		return dbToVibeSession(row);
	}

	async listVibeSessions(userId: string): Promise<VibeSession[]> {
		const rows = await db.selectFrom('vibe_sessions').selectAll().where('user_id', '=', userId).orderBy('updated_at', 'desc').execute();
		return rows.map(dbToVibeSession);
	}

	async updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void> {
		// If updates object is empty (excluding potential 'updatedAt' if it were part of UpdateVibeSessionData model), no-op.
		// However, vibeSessionToDbUpdate always sets 'updated_at', so an update will always occur if called.
		const relevantUpdateKeys = Object.keys(updates).filter((k) => k !== 'updatedAt');

		if (relevantUpdateKeys.length === 0) return; // No actual data to update besides the timestamp

		const dbUpdateData = vibeSessionToDbUpdate(updates);

		const result = await db.updateTable('vibe_sessions').set(dbUpdateData).where('id', '=', sessionId).where('user_id', '=', userId).executeTakeFirst(); // Kysely's executeTakeFirst for updates returns one result object

		if (!result || result.numUpdatedRows === 0n) {
			// Check if the session exists at all to provide a more specific error
			const exists = await db.selectFrom('vibe_sessions').select('id').where('id', '=', sessionId).executeTakeFirst();
			if (!exists) throw new Error(`VibeSession with id ${sessionId} not found.`);

			// Exists, but not for this user, or no effective change was made by the update data
			// The test expects 'not found' or 'authorized' error message for other user's sessions.
			// Kysely's update with where('user_id', ...) will result in numUpdatedRows === 0n if the user_id doesn't match.
			// So, if exists is true but numUpdatedRows is 0, it's likely an ownership issue or no effective change.
			// We'll throw a generic error that covers both cases, matching the test's expected regex /not found|authorized/i
			throw new Error(`VibeSession with id ${sessionId} not found for user ${userId} or no changes applied.`);
		}
	}

	async deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		await db.deleteFrom('vibe_sessions').where('id', '=', sessionId).where('user_id', '=', userId).execute();
		// Per tests, do not throw if not found or not owned (it simply won't delete anything)
	}

	async saveVibePreset(preset: VibePreset): Promise<string> {
		if (!preset.id) throw new Error('VibePreset ID must be provided for saving.');

		const dbPreset = vibePresetToDbInsert(preset);
		await db.insertInto('vibe_presets').values(dbPreset).executeTakeFirstOrThrow();
		return preset.id;
	}

	async listVibePresets(userId: string): Promise<VibePreset[]> {
		const rows = await db
			.selectFrom('vibe_presets')
			.selectAll()
			.where('user_id', '=', userId)
			.orderBy('created_at', 'desc') // Test expects this order
			.execute();
		return rows.map(dbToVibePreset);
	}

	async deleteVibePreset(userId: string, presetId: string): Promise<void> {
		await db.deleteFrom('vibe_presets').where('id', '=', presetId).where('user_id', '=', userId).execute();
		// Per tests, do not throw if not found or not owned
	}
}
