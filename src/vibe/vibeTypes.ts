import type { FieldValue } from '@google-cloud/firestore';

// --- VibeSession interface and related types ---
export interface VibeSession {
	id: string; // Primary key, ideally a UUID
	userId: string; // To associate with a user
	title: string;
	instructions: string;
	repositorySource: 'local' | 'github' | 'gitlab'; // Renamed from repositoryProvider
	repositoryId: string; // Renamed from repositoryIdentifier e.g., local path, 'owner/repo', 'group/project'
	repositoryName?: string; // Optional: e.g., 'my-cool-project'
	branch: string;
	newBranchName?: string; // Optional
	useSharedRepos: boolean;
	status: 'initializing' | 'design' | 'coding' | 'review' | 'completed' | 'error'; // Updated status values
	fileSelection?: { filePath: string; readOnly?: boolean }[]; // Updated fileSelection structure
	designAnswer?: string; // Store the generated design
	createdAt: FieldValue | Date; // Allow Date for in-memory, FieldValue for Firestore
	updatedAt: FieldValue | Date; // Allow Date for in-memory, FieldValue for Firestore
	error?: string; // Optional error message
}

// Define a type for the data needed to create a new session
// Note: Omit now includes 'error' as it's not provided at creation
export type CreateVibeSessionData = Omit<VibeSession, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'status' | 'error'>;

// Define a type for the data allowed in updates
export type UpdateVibeSessionData = Partial<Omit<VibeSession, 'id' | 'userId' | 'createdAt'>>;
// --- End Interface Definitions ---

/**
 * Interface for managing VibeSession data.
 */
export interface VibeService {
	/**
	 * Creates a new VibeSession.
	 * @param userId The ID of the user creating the session.
	 * @param sessionData Data for the new session.
	 * @returns The newly created VibeSession.
	 */
	createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession>;

	/**
	 * Retrieves a specific VibeSession by its ID for a given user.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to retrieve.
	 * @returns The VibeSession if found and authorized, otherwise null.
	 */
	getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null>;

	/**
	 * Lists all VibeSessions for the current user, ordered by creation date descending.
	 * @param userId The ID of the user whose sessions to list.
	 * @returns An array of VibeSessions.
	 */
	listVibeSessions(userId: string): Promise<VibeSession[]>;

	/**
	 * Updates specified fields of a VibeSession for a given user.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to update.
	 * @param updates An object containing the fields to update.
	 */
	updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void>;

	/**
	 * Deletes a VibeSession by its ID for a given user.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to delete.
	 */
	deleteVibeSession(userId: string, sessionId: string): Promise<void>;
}
