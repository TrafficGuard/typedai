import { createHash } from 'node:crypto';
import { agentContext } from '#agent/agentContextLocalStorage';
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
		return Promise.reject(new Error('Not implemented yet.'));
	}

	async setValue(scope: CacheScope, className: string, method: string, params: any[], value: any): Promise<void> {
		return Promise.reject(new Error('Not implemented yet.'));
	}

	async clearAgentCache(agentId: string): Promise<number> {
		return Promise.reject(new Error('Not implemented yet.'));
	}

	async clearUserCache(userId: string): Promise<number> {
		return Promise.reject(new Error('Not implemented yet.'));
	}
}
