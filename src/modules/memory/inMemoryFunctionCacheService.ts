import crypto from 'node:crypto';
import type { CacheScope, FunctionCacheService } from '../../cache/functionCacheService';

export class InMemoryFunctionCacheService implements FunctionCacheService {
	private cache: Map<string, any>;

	constructor() {
		this.cache = new Map<string, any>();
	}

	toJSON() {
		return {
			cacheSize: this.cache.size,
		};
	}

	fromJSON(obj: any): this {
		// In-memory cache can't be serialized/deserialized
		return this;
	}

	private getCacheKey(scope: CacheScope, className: string, method: string, params: any[]): string {
		const paramsString = this.toStringArg(params);
		return `${scope}:${className}:${method}:${paramsString}`;
	}

	private toStringArg(arg: any): string {
		if (arg === undefined) return 'undefined';
		if (arg === null) return 'null';
		if (typeof arg === 'string') {
			if (arg.length <= 20) return arg;
			return `${arg.slice(0, 2)}_${hashMd5(arg)}`;
		}
		if (typeof arg === 'number' || typeof arg === 'boolean') return arg.toString();
		if (Array.isArray(arg)) {
			return `[${arg.map((item) => this.toStringArg(item)).join('__')}]`;
		}
		if (typeof arg === 'object') {
			return `{${Object.entries(arg)
				.map(([key, value]) => `${key}_${this.toStringArg(value)}`)
				.join('__')}}`;
		}
		return '';
	}

	async getValue(scope: CacheScope, className: string, method: string, params: any[]): Promise<any> {
		const cacheKey = this.getCacheKey(scope, className, method, params);
		return this.cache.get(cacheKey);
	}

	async setValue(scope: CacheScope, className: string, method: string, params: any[], value: any): Promise<void> {
		const cacheKey = this.getCacheKey(scope, className, method, params);
		this.cache.set(cacheKey, value);
	}

	clearAgentCache(agentId: string): Promise<number> {
		let clearedCount = 0;
		for (const [key, value] of this.cache.entries()) {
			if (key.startsWith(`agent:${agentId}:`)) {
				this.cache.delete(key);
				clearedCount++;
			}
		}
		return Promise.resolve(clearedCount);
	}

	clearUserCache(userId: string): Promise<number> {
		let clearedCount = 0;
		for (const [key, value] of this.cache.entries()) {
			if (key.startsWith(`user:${userId}:`)) {
				this.cache.delete(key);
				clearedCount++;
			}
		}
		return Promise.resolve(clearedCount);
	}
}

function hashMd5(data: string): string {
	return crypto.createHash('md5').update(data).digest('hex');
}
