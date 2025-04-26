export interface VibeSession {
	id: string;
	title: string;
	status: 'initializing' | 'design' | 'coding' | 'review' | 'completed' | 'error'; // Match backend statuses
	createdAt: any; // Use 'any' or 'string' or 'Date' depending on how Firestore Timestamps are serialized/received
	// Add other fields if needed later
}

// Keep the old Vibe type if it's used elsewhere, otherwise remove it.
// export interface Vibe { }
