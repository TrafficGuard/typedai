/**
 * Review Comments:
 * 1. The Firestore structure is well-defined, separating cached values by scope (global, agent, user).
 * 2. The use of sub-collections for cache entries is a good practice to keep documents small and queries efficient.
 * 3. The getValue method checks for expiration, which is a good practice for cache management.
 * 4. The setValue method includes an optional expiration time, which is useful for cache invalidation.
 * 5. The getDocumentId method uses a hash to generate unique document IDs, which is a good practice to avoid collisions.
 * 6. Consider adding Firestore security rules to control access to the FunctionCache collection.
 * 7. Ensure that the Firestore emulator is properly configured for local development and testing.
 * 8. Use batched writes if multiple cache entries need to be set or updated simultaneously.
 * 9. Monitor Firestore usage and optimize queries to minimize read and write operations.
 */

import { createHash } from 'node:crypto';
import { type Firestore, Timestamp } from '@google-cloud/firestore';
import { agentContext } from '#agent/agentContext';
import { firestoreDb } from '#firestore/firestore';
import { logger } from '#o11y/logger';
import { currentUser } from '#user/userContext';
import type { CacheScope, FunctionCacheService } from '../../cache/functionCacheService';

/**
 *  Firestore structure.
 *  The scope key separates the cached values
 *
 *  FunctionCache
 *             ʟ  Global
 *                     ʟ  <hash(className_method_[params])>
 *             ʟ  Agent
 *                     ʟ <agentId>
 *                               ʟ  <hash(className_method_[params])>
 *                                     - value: ...
 *                                     - createdAt: Timestamp
 *                                     - expiresAt: Timestamp (optional)
 *                               ʟ  <hash(... )>
 *             ʟ  User
 *                    ʟ <userId>
 *                               ʟ  <hash(... )>
 *                               ʟ  <hash(... )>
 */
export class FirestoreCacheService implements FunctionCacheService {
	private db: Firestore = firestoreDb();

	getScopePath(scope: CacheScope): string {
		switch (scope) {
			case 'agent':
				return `agent-${agentContext()!.agentId}`;
			case 'user':
				return `user-${currentUser().id}`;
			case 'global':
				return 'global';
			default:
				return 'default';
		}
	}

	async getValue(scope: CacheScope, className: string, method: string, params: any[]): Promise<any> {
		const docId = this.getDocumentId(className, method, params);

		const docRef = this.db.collection('FunctionCache').doc(this.getScopePath(scope)).collection('Entries').doc(docId);
		const docSnap = await docRef.get();
		if (!docSnap.exists) {
			return undefined;
		}
		const data = docSnap.data();
		// Check for expiration (optional)
		if (data?.expiresAt && data.expiresAt.toMillis() < Date.now()) {
			return undefined;
		}
		return data?.value;
	}

	async setValue(scope: CacheScope, className: string, method: string, params: any[], value: any, expiresIn?: number): Promise<void> {
		const docId = this.getDocumentId(className, method, params);
		const docRef = this.db.collection('FunctionCache').doc(this.getScopePath(scope)).collection('Entries').doc(docId);
		try {
			const data: any = {
				value,
				createdAt: Timestamp.now(),
			};
			if (expiresIn) {
				data.expiresAt = Timestamp.fromMillis(Date.now() + expiresIn);
			}
			await docRef.set(data);
		} catch (error) {
			logger.error(error, 'Error setting cache value');
			throw error;
		}
	}

	private getDocumentId(className: string, method: string, params: any[]): string {
		const dataString = `${className}_${method}_${JSON.stringify(params)}`;
		return createHash('md5').update(dataString).digest('hex');
	}

	async clearAgentCache(agentId: string): Promise<number> {
		const collectionRef = this.db.collection('FunctionCache').doc(`agent-${agentId}`).collection('Entries');
		const snapshot = await collectionRef.get();
		const batch = this.db.batch();
		snapshot.docs.forEach((doc) => batch.delete(doc.ref));
		await batch.commit();
		return snapshot.size;
	}

	async clearUserCache(userId: string): Promise<number> {
		const collectionRef = this.db.collection('FunctionCache').doc(`user-${userId}`).collection('Entries');
		const snapshot = await collectionRef.get();
		const batch = this.db.batch();
		snapshot.docs.forEach((doc) => batch.delete(doc.ref));
		await batch.commit();
		return snapshot.size;
	}
}
