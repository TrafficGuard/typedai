import type { CacheScope } from '#cache/functionCacheService';

export interface FunctionCacheService {
	getValue(scope: CacheScope, key: string): Promise<any | null>;
	setValue(scope: CacheScope, key: string, value: any, ttlSeconds?: number): Promise<void>;
	clearAgentCache(agentId: string): Promise<void>;
	clearUserCache(userId: string): Promise<void>;
	// TODO: Consider if a global cache clear is needed e.g. clearGlobalCache(): Promise<void>;
}
