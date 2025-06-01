import type { CacheScope } from '#cache/functionCacheService';

export interface FunctionCacheService {
	getValue(scope: CacheScope, key: string): Promise<any | null>;
	setValue(scope: CacheScope, className: string, method: string, params: any[], value: any): Promise<void>;
	clearAgentCache(agentId: string): Promise<number>;
	clearUserCache(userId: string): Promise<void>;
	// TODO: Consider if a global cache clear is needed e.g. clearGlobalCache(): Promise<void>;
}
