import path from 'node:path';
import { getFileSystem } from '#agent/agentContextUtils';
import { typedaiDirName } from '#app/appDirs';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/files/fileSystemService';

const SYNC_STATE_FILENAME = 'sync-state.json';

/**
 * Sync state tracking for Cloud SQL summary storage.
 * Tracks last successful sync times and pending changes.
 */
export interface SyncState {
	/** ISO timestamp of last successful pull from Cloud SQL */
	lastSuccessfulPull: string | null;
	/** ISO timestamp of last successful push to Cloud SQL */
	lastSuccessfulPush: string | null;
	/** File paths that failed to push and need retry */
	pendingPushPaths: string[];
	/** Repository ID for this sync state */
	repositoryId: string;
}

/**
 * Creates a new empty sync state
 */
export function createEmptySyncState(repositoryId: string): SyncState {
	return {
		lastSuccessfulPull: null,
		lastSuccessfulPush: null,
		pendingPushPaths: [],
		repositoryId,
	};
}

/**
 * Gets the path to the sync state file
 */
function getSyncStatePath(fss: IFileSystemService): string {
	const workingDir = fss.getWorkingDirectory();
	return path.join(workingDir, typedaiDirName, SYNC_STATE_FILENAME);
}

/**
 * Loads the sync state from disk.
 * Returns null if no sync state exists or it's invalid.
 */
export async function loadSyncState(fss: IFileSystemService = getFileSystem()): Promise<SyncState | null> {
	const statePath = getSyncStatePath(fss);

	try {
		if (!(await fss.fileExists(statePath))) {
			return null;
		}

		const content = await fss.readFile(statePath);
		const state = JSON.parse(content) as SyncState;

		// Validate structure
		if (typeof state.repositoryId !== 'string') {
			logger.warn('Invalid sync state: missing repositoryId');
			return null;
		}

		return state;
	} catch (error) {
		logger.warn({ error }, 'Failed to load sync state');
		return null;
	}
}

/**
 * Saves the sync state to disk.
 */
export async function saveSyncState(state: SyncState, fss: IFileSystemService = getFileSystem()): Promise<void> {
	const statePath = getSyncStatePath(fss);

	try {
		await fss.writeFile(statePath, JSON.stringify(state, null, 2));
		logger.debug({ statePath }, 'Saved sync state');
	} catch (error) {
		logger.error({ error }, 'Failed to save sync state');
		throw error;
	}
}

/**
 * Updates the sync state after a successful pull
 */
export async function recordSuccessfulPull(repositoryId: string, fss: IFileSystemService = getFileSystem()): Promise<void> {
	const existing = await loadSyncState(fss);
	const state: SyncState = existing || createEmptySyncState(repositoryId);

	state.lastSuccessfulPull = new Date().toISOString();
	state.repositoryId = repositoryId;

	await saveSyncState(state, fss);
}

/**
 * Updates the sync state after a successful push
 */
export async function recordSuccessfulPush(repositoryId: string, fss: IFileSystemService = getFileSystem()): Promise<void> {
	const existing = await loadSyncState(fss);
	const state: SyncState = existing || createEmptySyncState(repositoryId);

	state.lastSuccessfulPush = new Date().toISOString();
	state.pendingPushPaths = []; // Clear pending on successful push
	state.repositoryId = repositoryId;

	await saveSyncState(state, fss);
}

/**
 * Records paths that failed to push for later retry
 */
export async function recordPendingPush(repositoryId: string, failedPaths: string[], fss: IFileSystemService = getFileSystem()): Promise<void> {
	const existing = await loadSyncState(fss);
	const state: SyncState = existing || createEmptySyncState(repositoryId);

	// Merge with existing pending paths, avoiding duplicates
	const pendingSet = new Set([...state.pendingPushPaths, ...failedPaths]);
	state.pendingPushPaths = Array.from(pendingSet);
	state.repositoryId = repositoryId;

	await saveSyncState(state, fss);
}

/**
 * Gets a human-readable sync status message
 */
export function getSyncStatusMessage(state: SyncState | null): string {
	if (!state) {
		return 'No sync history found';
	}

	const parts: string[] = [];

	if (state.lastSuccessfulPull) {
		const pullDate = new Date(state.lastSuccessfulPull);
		parts.push(`Last pull: ${pullDate.toLocaleString()}`);
	} else {
		parts.push('Never pulled from Cloud SQL');
	}

	if (state.lastSuccessfulPush) {
		const pushDate = new Date(state.lastSuccessfulPush);
		parts.push(`Last push: ${pushDate.toLocaleString()}`);
	} else {
		parts.push('Never pushed to Cloud SQL');
	}

	if (state.pendingPushPaths.length > 0) {
		parts.push(`Pending: ${state.pendingPushPaths.length} paths need sync`);
	}

	return parts.join(' | ');
}
