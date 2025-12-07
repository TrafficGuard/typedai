import { createHash } from 'node:crypto';
import { agentContext } from '#agent/agentContext';
import { currentUser } from '#user/userContext';
import type { CacheScope, FunctionCacheService } from '../../cache/functionCacheService';
import { db } from './db';

export class PostgresFunctionCacheService implements FunctionCacheService {
	private _getCacheKeyHash(className: string, method: string, params: any[]): string {
		const dataString = `${className}_${method}_${JSON.stringify(params)}`;
		return createHash('md5').update(dataString).digest('hex');
	}

	private _getScopeIdentifier(scope: CacheScope): string | null {
		if (scope === 'agent') {
			const context = agentContext();
			if (!context) throw new Error('Agent context is unavailable for agent-scoped cache.');
			return context.agentId;
		}
		if (scope === 'user') {
			const user = currentUser();
			if (!user) throw new Error('User context is unavailable for user-scoped cache.');
			return user.id;
		}
		if (scope === 'global') {
			return null;
		}
		// Should not happen with CacheScope type, but as a safeguard:
		throw new Error(`Invalid cache scope: ${scope}`);
	}

	async getValue(scope: CacheScope, className: string, method: string, params: any[]): Promise<any> {
		const cacheKeyHash = this._getCacheKeyHash(className, method, params);
		const scopeIdentifier = this._getScopeIdentifier(scope);

		const result = await db
			.selectFrom('function_cache')
			.selectAll()
			.where('scope', '=', scope)
			.where('scope_identifier', scopeIdentifier === null ? 'is' : '=', scopeIdentifier)
			.where('cache_key_hash', '=', cacheKeyHash)
			.executeTakeFirst();

		if (!result) {
			return undefined;
		}

		// Check for expiration
		if (result.expires_at && new Date(result.expires_at).getTime() < Date.now()) {
			return undefined;
		}

		return JSON.parse(result.value_json);
	}

	async setValue(scope: CacheScope, className: string, method: string, params: any[], value: any, expiresIn?: number): Promise<void> {
		const cacheKeyHash = this._getCacheKeyHash(className, method, params);
		const scopeIdentifier = this._getScopeIdentifier(scope);
		const valueJson = JSON.stringify(value);
		const now = new Date();
		const expiresAt = expiresIn ? new Date(Date.now() + expiresIn) : null;

		// Use an upsert pattern: insert or update if conflict
		// First, try to find if it exists
		const existing = await db
			.selectFrom('function_cache')
			.select('id')
			.where('scope', '=', scope)
			.where('scope_identifier', scopeIdentifier === null ? 'is' : '=', scopeIdentifier)
			.where('cache_key_hash', '=', cacheKeyHash)
			.executeTakeFirst();

		if (existing) {
			// Update existing record
			await db
				.updateTable('function_cache')
				.set({
					value_json: valueJson,
					created_at: now,
					expires_at: expiresAt,
				})
				.where('id', '=', existing.id)
				.execute();
		} else {
			// Insert new record
			await db
				.insertInto('function_cache')
				.values({
					id: `${scope}-${scopeIdentifier || 'null'}-${cacheKeyHash}`,
					scope,
					scope_identifier: scopeIdentifier,
					cache_key_hash: cacheKeyHash,
					value_json: valueJson,
					created_at: now,
					expires_at: expiresAt,
				})
				.execute();
		}
	}

	async clearAgentCache(agentId: string): Promise<number> {
		const result = await db.deleteFrom('function_cache').where('scope', '=', 'agent').where('scope_identifier', '=', agentId).executeTakeFirst();

		return Number(result.numDeletedRows || 0);
	}

	async clearUserCache(userId: string): Promise<number> {
		const result = await db.deleteFrom('function_cache').where('scope', '=', 'user').where('scope_identifier', '=', userId).executeTakeFirst();

		return Number(result.numDeletedRows || 0);
	}
}
