import type { FunctionCacheService } from '../cache/functionCacheService';
import type { CacheScope } from '#cache/functionCacheService';

export class MongoFunctionCacheService implements FunctionCacheService {
	constructor() {
		// TODO: Implement constructor
	}

	async getValue(scope: CacheScope, key: string): Promise<any | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async setValue(scope: CacheScope, className: string, method: string, params: any[], value: any): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async clearAgentCache(agentId: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async clearUserCache(userId: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}
}
